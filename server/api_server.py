#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WithYou pair API — private couple location / battery / presence.

Default: http://0.0.0.0:9610
Cloudflare: path /withyou → http://127.0.0.1:9610  (or hostname)

Clients: **Android APK + iOS IPA only** (no web/PWA app).
Browser visitors get the install page (APK/IPA download).

Pair model:
  - One of you creates a pair → invite code
  - Partner joins with code → both get device tokens
  - Heartbeat posts live location + battery
  - Each device only sees the other member of the same pair
"""
from __future__ import annotations

import json
import math
import os
import re
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Optional
from urllib.parse import parse_qs, urlparse

HOST = os.environ.get("WITHYOU_HOST", "0.0.0.0")
PORT = int(os.environ.get("WITHYOU_PORT", "9610") or "9610")
DATA_DIR = Path(__file__).resolve().parent / "data"
DATA_FILE = DATA_DIR / "pairs.json"
DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
FILE_CHUNK = 64 * 1024

# Web/PWA UI is intentionally disabled — APK + IPA only.
MAX_HISTORY = 80
HEARTBEAT_STALE_S = 120  # >2 min without beat → offline
PLACE_MOVE_M = 80  # re-count "arrived" if moved more than this
HOME_RADIUS_M = 120

_lock = threading.RLock()
_db: dict[str, Any] = {"pairs": {}, "devices": {}}


def _log(msg: str) -> None:
    print(f"[WithYou] {msg}", flush=True)


def _now() -> float:
    return time.time()


def _heading_cardinal(deg: Any) -> str:
    try:
        d = float(deg) % 360
    except (TypeError, ValueError):
        return ""
    dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
    return dirs[int((d + 22.5) // 45) % 8]


def _motion_from_speed(speed_mps: Any) -> str:
    try:
        s = float(speed_mps)
    except (TypeError, ValueError):
        return "unknown"
    if s < 0.4:
        return "still"
    if s < 2.0:
        return "walking"
    if s < 8.0:
        return "running_or_bike"
    return "driving"


def _clip_str(v: Any, n: int) -> str:
    return str(v or "")[:n]


def _send_expo_push(tokens: list[str], title: str, body: str, data: Optional[dict] = None) -> None:
    """Best-effort Expo push (Expo Go / standalone with projectId)."""
    toks = [t for t in tokens if isinstance(t, str) and t.startswith("ExponentPushToken")]
    if not toks:
        return
    try:
        import urllib.request

        payload = [
            {
                "to": t,
                "title": title[:80],
                "body": body[:200],
                "sound": "default",
                "data": data or {},
            }
            for t in toks
        ]
        req = urllib.request.Request(
            "https://exp.host/--/api/v2/push/send",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "WithYou-API/1.1",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=8) as resp:
            resp.read()
    except Exception as e:
        _log(f"push failed: {e}")


def _partner_push_tokens(pair: dict, me_id: str) -> list[str]:
    out: list[str] = []
    for did, d in (pair.get("members") or {}).items():
        if did == me_id:
            continue
        tok = d.get("push_token")
        if tok:
            out.append(str(tok))
    return out


def _compute_member_stats(member: dict, now: float) -> dict:
    hist = list(member.get("history") or [])
    day_start = now - (now % 86400)
    today = [h for h in hist if float(h.get("ts") or 0) >= day_start]
    traveled = 0.0
    for i in range(1, len(today)):
        a, b = today[i - 1], today[i]
        try:
            traveled += _haversine_m(
                float(a["lat"]), float(a["lng"]), float(b["lat"]), float(b["lng"])
            )
        except (KeyError, TypeError, ValueError):
            pass
    places = set()
    for h in today:
        pn = (h.get("place_name") or "").strip().lower()
        if pn:
            places.add(pn)
    return {
        "points_today": len(today),
        "traveled_m_today": round(traveled),
        "places_today": len(places),
    }


def _load() -> None:
    global _db
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not DATA_FILE.is_file():
        _db = {"pairs": {}, "devices": {}}
        return
    try:
        raw = json.loads(DATA_FILE.read_text(encoding="utf-8-sig"))
        if isinstance(raw, dict):
            _db = {
                "pairs": raw.get("pairs") if isinstance(raw.get("pairs"), dict) else {},
                "devices": raw.get("devices") if isinstance(raw.get("devices"), dict) else {},
            }
    except Exception as e:
        _log(f"load failed: {e}")
        _db = {"pairs": {}, "devices": {}}


def _save() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(_db, indent=2), encoding="utf-8")
    tmp.replace(DATA_FILE)


def _haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def _public_device(d: dict, *, hide_token: bool = True) -> dict:
    last = float(d.get("last_seen") or 0)
    now = _now()
    online = (now - last) <= HEARTBEAT_STALE_S if last else False
    speed = d.get("speed_mps")
    try:
        speed_kmh = round(float(speed) * 3.6, 1) if speed is not None else None
    except (TypeError, ValueError):
        speed_kmh = None
    motion = d.get("motion") or _motion_from_speed(speed)
    arrived = d.get("arrived_at")
    try:
        time_at_place_s = int(max(0, now - float(arrived))) if arrived else None
    except (TypeError, ValueError):
        time_at_place_s = None
    heading = d.get("heading")
    stats = _compute_member_stats(d, now)
    # home distance
    dist_home = d.get("dist_from_home_m")
    at_home = None
    if dist_home is not None:
        try:
            at_home = float(dist_home) <= HOME_RADIUS_M
        except (TypeError, ValueError):
            at_home = None
    out = {
        "device_id": d.get("device_id"),
        "display_name": d.get("display_name") or "Partner",
        "emoji": d.get("emoji") or "💕",
        "last_seen": last or None,
        "online": online,
        "battery": d.get("battery"),
        "charging": bool(d.get("charging")),
        "low_power": bool(d.get("low_power")),
        "lat": d.get("lat"),
        "lng": d.get("lng"),
        "accuracy_m": d.get("accuracy_m"),
        "speed_mps": d.get("speed_mps"),
        "speed_kmh": speed_kmh,
        "heading": heading,
        "heading_cardinal": d.get("heading_cardinal") or _heading_cardinal(heading),
        "altitude_m": d.get("altitude_m"),
        "network": d.get("network") or "",
        "is_wifi": bool(d.get("is_wifi")) if d.get("is_wifi") is not None else None,
        "is_internet": bool(d.get("is_internet")) if d.get("is_internet") is not None else None,
        "cellular_gen": d.get("cellular_gen") or "",
        "carrier": d.get("carrier") or "",
        "platform": d.get("platform") or "",
        "app_version": d.get("app_version") or "",
        "device_model": d.get("device_model") or "",
        "device_brand": d.get("device_brand") or "",
        "os_name": d.get("os_name") or "",
        "os_version": d.get("os_version") or "",
        "timezone": d.get("timezone") or "",
        "locale": d.get("locale") or "",
        "app_state": d.get("app_state") or "",
        "motion": motion,
        "place_name": d.get("place_name") or "",
        "place_city": d.get("place_city") or "",
        "place_region": d.get("place_region") or "",
        "place_country": d.get("place_country") or "",
        "arrived_at": arrived,
        "time_at_place_s": time_at_place_s,
        "dist_from_home_m": dist_home,
        "at_home": at_home,
        "home_set": bool(d.get("home_lat") is not None and d.get("home_lng") is not None),
        "mood": d.get("mood") or "",
        "status_text": d.get("status_text") or "",
        "activity": d.get("activity") or "",
        "love_note": d.get("love_note") or "",
        "love_note_at": d.get("love_note_at"),
        "love_note_from": d.get("love_note_from") or "",
        "thinking_of_you_at": d.get("thinking_of_you_at"),
        "sos_active": bool(d.get("sos_active")),
        "sos_message": d.get("sos_message") or "",
        "sos_at": d.get("sos_at"),
        "weather_temp_c": d.get("weather_temp_c"),
        "weather_code": d.get("weather_code"),
        "weather_label": d.get("weather_label") or "",
        "local_hour": d.get("local_hour"),
        "day_night": d.get("day_night") or "",
        "points_today": stats["points_today"],
        "traveled_m_today": stats["traveled_m_today"],
        "places_today": stats["places_today"],
        "ping_count": int(d.get("ping_count") or 0),
        "note_count": int(d.get("note_count") or 0),
    }
    return out


def _pair_stats(pair: dict, me_id: str, dist: Optional[float]) -> dict:
    """Couple-level stats for the dashboard."""
    members = pair.get("members") or {}
    me = members.get(me_id) or {}
    partner = None
    for did, d in members.items():
        if did != me_id:
            partner = d
            break
    now = _now()
    day_start = now - (now % 86400)
    # distance history for today from either side's last beats
    max_d = pair.get("max_distance_today")
    min_d = pair.get("min_distance_today")
    max_day = pair.get("max_distance_day")
    min_day = pair.get("min_distance_day")
    if max_day != int(day_start):
        max_d, min_d = None, None
    if dist is not None:
        if max_d is None or dist > max_d:
            max_d = dist
        if min_d is None or dist < min_d:
            min_d = dist
        pair["max_distance_today"] = max_d
        pair["min_distance_today"] = min_d
        pair["max_distance_day"] = int(day_start)
        pair["min_distance_day"] = int(day_start)
    pings = int(me.get("ping_count") or 0) + int((partner or {}).get("ping_count") or 0)
    notes = int(me.get("note_count") or 0) + int((partner or {}).get("note_count") or 0)
    return {
        "max_distance_m_today": max_d,
        "min_distance_m_today": min_d,
        "care_pings_total": pings,
        "love_notes_total": notes,
        "both_online": bool(
            me
            and partner
            and (_now() - float(me.get("last_seen") or 0)) <= HEARTBEAT_STALE_S
            and (_now() - float(partner.get("last_seen") or 0)) <= HEARTBEAT_STALE_S
        ),
    }


def _pair_public(pair: dict, me_id: str) -> dict:
    members = pair.get("members") or {}
    me = members.get(me_id) or {}
    partner = None
    for did, d in members.items():
        if did != me_id:
            partner = d
            break
    dist = None
    if (
        partner
        and me.get("lat") is not None
        and me.get("lng") is not None
        and partner.get("lat") is not None
        and partner.get("lng") is not None
    ):
        try:
            dist = round(
                _haversine_m(
                    float(me["lat"]),
                    float(me["lng"]),
                    float(partner["lat"]),
                    float(partner["lng"]),
                )
            )
        except (TypeError, ValueError):
            dist = None
    together_since = pair.get("together_since") or pair.get("created")
    days = None
    if together_since:
        days = max(0, int((_now() - float(together_since)) // 86400))
    stats = _pair_stats(pair, me_id, dist)
    # recent partner trail
    trail = []
    if partner:
        for h in list(partner.get("history") or [])[-12:]:
            trail.append(
                {
                    "ts": h.get("ts"),
                    "lat": h.get("lat"),
                    "lng": h.get("lng"),
                    "place_name": h.get("place_name") or "",
                    "battery": h.get("battery"),
                }
            )
    return {
        "pair_id": pair.get("pair_id"),
        "invite_code": pair.get("invite_code"),
        "together_since": together_since,
        "days_together": days,
        "me": _public_device(me),
        "partner": _public_device(partner) if partner else None,
        "distance_m": dist,
        "partner_joined": partner is not None,
        "stats": stats,
        "partner_trail": trail,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "WithYou/1.0"
    sys_version = ""

    def log_message(self, fmt: str, *args) -> None:
        return

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, Authorization, X-App-Version, X-Device-Id",
        )
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")

    def _json(self, code: int, payload: Any) -> None:
        body = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if n <= 0:
            return {}
        if n > 200_000:
            raise ValueError("body too large")
        raw = self.rfile.read(n)
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else {}

    def _auth_device(self) -> Optional[tuple[str, dict, dict]]:
        """Returns (device_id, device, pair) or None."""
        auth = (self.headers.get("Authorization") or "").strip()
        if not auth or len(auth) < 16:
            return None
        with _lock:
            dev = _db["devices"].get(auth)
            if not isinstance(dev, dict):
                return None
            pair_id = dev.get("pair_id")
            pair = _db["pairs"].get(pair_id)
            if not isinstance(pair, dict):
                return None
            mid = dev.get("device_id")
            member = (pair.get("members") or {}).get(mid)
            if not isinstance(member, dict):
                return None
            return mid, member, pair

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_HEAD(self) -> None:  # noqa: N802
        # Same routes as GET but without body (for download probes / curl -I)
        self._get_or_head(body=False)

    def do_GET(self) -> None:  # noqa: N802
        self._get_or_head(body=True)

    def _send_install_page(self, *, body: bool) -> None:
        apk = DIST_DIR / "WithYou.apk"
        ipa = DIST_DIR / "WithYou.ipa"
        if not ipa.is_file():
            ipa = DIST_DIR / "WithYou-Sideloadly.ipa"

        def sz(p: Path) -> str:
            if not p.is_file():
                return "missing"
            n = p.stat().st_size
            return f"{n / (1024 * 1024):.1f} MB"

        apk_ok = apk.is_file()
        ipa_ok = ipa.is_file()
        # Absolute public URLs (same host, /withyou path)
        apk_href = "https://crew.kingdom.forum/withyou/install/apk"
        ipa_href = "https://crew.kingdom.forum/withyou/install/ipa"
        html = f"""<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#0b0810"/>
<meta name="robots" content="noindex"/>
<title>WithYou — Install</title>
<style>
body{{margin:0;min-height:100vh;background:radial-gradient(900px 500px at 50% -10%,#1a1024,#0b0810 55%);
color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
display:flex;align-items:center;justify-content:center;padding:20px}}
.w{{max-width:440px;width:100%}}
h1{{color:#f8fafc;margin:0 0 6px;font-size:1.85rem;letter-spacing:-.03em;font-weight:900}}
.badge{{display:inline-block;background:rgba(244,114,182,.14);color:#f472b6;font-size:.7rem;font-weight:800;
padding:4px 10px;border-radius:999px;margin-bottom:12px;letter-spacing:.04em;text-transform:uppercase}}
.t{{color:#a8b0c0;margin:0 0 20px;line-height:1.5}}
.c{{background:#16121f;border:1px solid rgba(255,255,255,.07);border-radius:18px;padding:18px;margin-bottom:14px;
box-shadow:0 10px 30px rgba(0,0,0,.25)}}
.c h2{{margin:0 0 6px;font-size:1.05rem;font-weight:800}} .m{{color:#6b7289;font-size:.85rem;margin:0 0 12px}}
a.btn{{display:block;text-align:center;background:linear-gradient(135deg,#fb8ec4,#f472b6 50%,#e85a9e);color:#1a0a12;
font-weight:800;text-decoration:none;padding:16px;border-radius:14px;font-size:1rem;
box-shadow:0 8px 24px rgba(244,114,182,.28)}} a.btn:active{{opacity:.9}}
span.off{{display:block;text-align:center;background:#2d2438;color:#64748b;padding:16px;border-radius:14px;font-weight:700}}
ol{{margin:12px 0 0;padding-left:1.2rem;color:#a8b0c0;font-size:.85rem;line-height:1.55}}
.warn{{color:#fbbf24;font-size:.8rem;margin-top:10px;line-height:1.4}}
.foot{{text-align:center;margin-top:18px;color:#4b5163;font-size:.75rem;line-height:1.5}}
</style></head><body><div class="w">
<span class="badge">Native apps only · APK + IPA</span>
<h1>WithYou</h1>
<p class="t">Private couple app for two phones. No web app — install Android APK or iPhone IPA.</p>
<div class="c">
<h2>Android APK</h2>
<p class="m">{sz(apk)} · com.withyou.pair</p>
{"<a class='btn' href='"+apk_href+"' download='WithYou.apk'>Download APK</a>" if apk_ok else "<span class='off'>APK missing on server</span>"}
<ol>
<li>Open this page in <b>Chrome</b> on Android</li>
<li>Tap Download APK (~70 MB — wait for it)</li>
<li>Allow <b>Install unknown apps</b> for Chrome if asked</li>
<li>Open the file and Install</li>
</ol>
<p class="warn">If download fails: use Wi‑Fi and open again:<br>{apk_href}</p>
</div>
<div class="c">
<h2>iPhone IPA</h2>
<p class="m">{sz(ipa)} · install with Sideloadly + free Apple ID on a PC</p>
{"<a class='btn' href='"+ipa_href+"' download='WithYou.ipa'>Download IPA</a>" if ipa_ok else "<span class='off'>IPA missing</span>"}
<ol>
<li>Download IPA on Windows</li>
<li>Open in <b>Sideloadly</b> with your free Apple ID</li>
<li>Connect iPhone by USB · install · Trust developer on phone</li>
<li>Re-sign about every 7 days (free cert)</li>
</ol>
</div>
<p class="foot">API for the apps only · no browser version</p>
</div></body></html>"""
        data = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        if body:
            self.wfile.write(data)

    def _send_dist_file(
        self,
        filename: str,
        content_type: str,
        *,
        body: bool,
        download_as: Optional[str] = None,
    ) -> None:
        if ".." in filename or "/" in filename or "\\" in filename:
            self._json(400, {"error": "bad name"})
            return
        path = (DIST_DIR / filename).resolve()
        try:
            if not path.is_file() or not str(path).startswith(str(DIST_DIR.resolve())):
                self._json(404, {"error": f"missing {filename}"})
                return
            size = path.stat().st_size
        except OSError:
            self._json(404, {"error": f"missing {filename}"})
            return

        out_name = download_as or filename
        safe = "".join(c for c in out_name if c.isalnum() or c in "._-")
        # Range support (phones resume big APKs)
        start, end = 0, size - 1
        status = 200
        rng = (self.headers.get("Range") or "").strip()
        if rng.lower().startswith("bytes=") and "-" in rng:
            spec = rng.split("=", 1)[1]
            if "," not in spec:
                a, b = spec.split("-", 1)
                try:
                    if a == "":
                        n = int(b)
                        start = max(0, size - n)
                    else:
                        start = int(a)
                        end = int(b) if b else size - 1
                    end = min(end, size - 1)
                    if 0 <= start <= end:
                        status = 206
                    else:
                        start, end = 0, size - 1
                        status = 200
                except ValueError:
                    start, end = 0, size - 1
                    status = 200
        length = end - start + 1
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header(
            "Content-Disposition",
            f'attachment; filename="{safe}"; filename*=UTF-8\'\'{safe}',
        )
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "public, max-age=300")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        if not body:
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                left = length
                while left > 0:
                    chunk = f.read(min(FILE_CHUNK, left))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)
        except (OSError, BrokenPipeError, ConnectionResetError):
            pass

    def _get_or_head(self, *, body: bool) -> None:
        raw_path = urlparse(self.path).path
        path = raw_path.rstrip("/") or "/"
        under_withyou = path.startswith("/withyou")
        # Allow both /withyou/* and /* (tunnel strip or not)
        if under_withyou:
            path = path[len("/withyou") :] or "/"

        # Install page + APK/IPA only (no browser/PWA app)
        if path in (
            "/",
            "/app",
            "/index.html",
            "/install",
            "/download",
            "/downloads",
        ):
            accept = (self.headers.get("Accept") or "").lower()
            # API probes / mobile may request JSON on /
            if path == "/" and "application/json" in accept and "text/html" not in accept:
                self._json(
                    200,
                    {
                        "ok": True,
                        "service": "withyou",
                        "version": "1.1.1",
                        "clients": ["apk", "ipa"],
                        "pwa": False,
                        "time": _now(),
                    },
                )
                return
            self._send_install_page(body=body)
            return
        if path in ("/install/apk", "/download/apk", "/downloads/apk", "/WithYou.apk"):
            self._send_dist_file(
                "WithYou.apk",
                "application/vnd.android.package-archive",
                body=body,
            )
            return
        if path in ("/install/ipa", "/download/ipa", "/downloads/ipa", "/WithYou.ipa"):
            name = "WithYou.ipa"
            if not (DIST_DIR / name).is_file():
                name = "WithYou-Sideloadly.ipa"
            self._send_dist_file(name, "application/octet-stream", body=body, download_as="WithYou.ipa")
            return

        # Old PWA assets → install page (no web app)
        if path in (
            "/app.js",
            "/sw.js",
            "/manifest.webmanifest",
            "/manifest.json",
            "/icon-192.png",
            "/icon-512.png",
        ):
            self._send_install_page(body=body)
            return

        if path in ("/health",):
            self._json(
                200,
                {
                    "ok": True,
                    "service": "withyou",
                    "version": "1.1.1",
                    "clients": ["apk", "ipa"],
                    "pwa": False,
                    "time": _now(),
                },
            )
            return

        if path == "/me":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            with _lock:
                self._json(200, {"ok": True, **_pair_public(pair, mid)})
            return

        if path == "/partner":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            with _lock:
                pub = _pair_public(pair, mid)
            self._json(200, {"ok": True, "partner": pub.get("partner"), "distance_m": pub.get("distance_m"), "days_together": pub.get("days_together")})
            return

        if path == "/history":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            partner = None
            for did, d in (pair.get("members") or {}).items():
                if did != mid:
                    partner = d
                    break
            hist = list((partner or {}).get("history") or [])[-MAX_HISTORY:]
            self._json(200, {"ok": True, "history": hist})
            return

        self._json(404, {"error": "Not found", "path": path})

    def do_POST(self) -> None:  # noqa: N802
        path = urlparse(self.path).path.rstrip("/") or "/"
        if path.startswith("/withyou"):
            path = path[len("/withyou") :] or "/"

        try:
            data = self._read_json()
        except Exception:
            self._json(400, {"error": "Bad JSON"})
            return

        if path == "/pair/create":
            name = str(data.get("display_name") or "Me").strip()[:32] or "Me"
            emoji = str(data.get("emoji") or "💙").strip()[:8] or "💙"
            platform = str(data.get("platform") or "").strip()[:16]
            device_id = secrets.token_hex(8)
            token = secrets.token_hex(24)
            pair_id = secrets.token_hex(8)
            invite = secrets.token_hex(3).upper()  # 6 hex chars
            now = _now()
            member = {
                "device_id": device_id,
                "display_name": name,
                "emoji": emoji,
                "platform": platform,
                "token": token,
                "joined": now,
                "last_seen": now,
                "history": [],
            }
            pair = {
                "pair_id": pair_id,
                "invite_code": invite,
                "created": now,
                "together_since": now,
                "members": {device_id: member},
            }
            with _lock:
                _db["pairs"][pair_id] = pair
                _db["devices"][token] = {"pair_id": pair_id, "device_id": device_id}
                _save()
            self._json(
                200,
                {
                    "ok": True,
                    "token": token,
                    "device_id": device_id,
                    "pair_id": pair_id,
                    "invite_code": invite,
                    "me": _public_device(member),
                    "partner": None,
                    "days_together": 0,
                },
            )
            return

        if path == "/pair/join":
            # Accept spaces / dashes / lowercase; codes are 6 hex chars
            code = re.sub(r"[^A-Fa-f0-9]", "", str(data.get("invite_code") or "")).upper()
            name = str(data.get("display_name") or "Partner").strip()[:32] or "Partner"
            emoji = str(data.get("emoji") or "💗").strip()[:8] or "💗"
            platform = str(data.get("platform") or "").strip()[:16]
            if len(code) < 4:
                self._json(
                    400,
                    {
                        "error": "Invalid invite code — need the 6-character code from Create pair",
                    },
                )
                return
            with _lock:
                pair = None
                for p in _db["pairs"].values():
                    if str(p.get("invite_code") or "").upper() == code:
                        pair = p
                        break
                if not pair:
                    self._json(
                        404,
                        {
                            "error": "Invite not found — check the code, or create a new pair",
                        },
                    )
                    return
                members = pair.setdefault("members", {})
                if len(members) >= 2:
                    self._json(
                        409,
                        {
                            "error": "Pair already full (2 phones max). Create a new pair.",
                        },
                    )
                    return
                device_id = secrets.token_hex(8)
                token = secrets.token_hex(24)
                now = _now()
                member = {
                    "device_id": device_id,
                    "display_name": name,
                    "emoji": emoji,
                    "platform": platform,
                    "token": token,
                    "joined": now,
                    "last_seen": now,
                    "history": [],
                }
                members[device_id] = member
                _db["devices"][token] = {
                    "pair_id": pair["pair_id"],
                    "device_id": device_id,
                }
                _save()
                pub = _pair_public(pair, device_id)
            self._json(
                200,
                {
                    "ok": True,
                    "token": token,
                    "device_id": device_id,
                    "pair_id": pair["pair_id"],
                    **{k: pub[k] for k in ("me", "partner", "days_together", "distance_m")},
                },
            )
            return

        if path == "/heartbeat":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            push_events: list[tuple[str, str, dict]] = []
            with _lock:
                member = (pair.get("members") or {}).get(mid)
                if not isinstance(member, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                now = _now()
                prev_battery = member.get("battery")
                prev_online = bool(member.get("last_seen")) and (
                    now - float(member.get("last_seen") or 0)
                ) <= HEARTBEAT_STALE_S
                member["last_seen"] = now
                # optional profile
                if data.get("display_name"):
                    member["display_name"] = str(data.get("display_name"))[:32]
                if data.get("emoji"):
                    member["emoji"] = str(data.get("emoji"))[:8]
                if data.get("mood") is not None:
                    member["mood"] = str(data.get("mood"))[:40]
                if data.get("status_text") is not None:
                    member["status_text"] = str(data.get("status_text"))[:120]
                if data.get("activity") is not None:
                    member["activity"] = _clip_str(data.get("activity"), 32)
                # battery
                if data.get("battery") is not None:
                    try:
                        b = float(data.get("battery"))
                        member["battery"] = max(0.0, min(100.0, b))
                    except (TypeError, ValueError):
                        pass
                if "charging" in data:
                    member["charging"] = bool(data.get("charging"))
                if "low_power" in data:
                    member["low_power"] = bool(data.get("low_power"))
                # device / network extras
                for k, n in (
                    ("network", 32),
                    ("platform", 16),
                    ("app_version", 24),
                    ("device_model", 48),
                    ("device_brand", 32),
                    ("os_name", 24),
                    ("os_version", 24),
                    ("timezone", 48),
                    ("locale", 24),
                    ("app_state", 16),
                    ("cellular_gen", 16),
                    ("carrier", 40),
                    ("place_name", 80),
                    ("place_city", 48),
                    ("place_region", 48),
                    ("place_country", 48),
                    ("weather_label", 40),
                    ("day_night", 12),
                    ("motion", 24),
                    ("heading_cardinal", 4),
                ):
                    if data.get(k) is not None:
                        member[k] = _clip_str(data.get(k), n)
                for k in ("is_wifi", "is_internet"):
                    if k in data:
                        member[k] = bool(data.get(k))
                if data.get("local_hour") is not None:
                    try:
                        member["local_hour"] = int(data.get("local_hour")) % 24
                    except (TypeError, ValueError):
                        pass
                if data.get("weather_temp_c") is not None:
                    try:
                        member["weather_temp_c"] = round(float(data.get("weather_temp_c")), 1)
                    except (TypeError, ValueError):
                        pass
                if data.get("weather_code") is not None:
                    try:
                        member["weather_code"] = int(data.get("weather_code"))
                    except (TypeError, ValueError):
                        pass
                # location
                lat = data.get("lat")
                lng = data.get("lng")
                if lat is not None and lng is not None:
                    try:
                        lat_f, lng_f = float(lat), float(lng)
                        if -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
                            prev_lat, prev_lng = member.get("lat"), member.get("lng")
                            member["lat"] = lat_f
                            member["lng"] = lng_f
                            for k_src, k_dst in (
                                ("accuracy_m", "accuracy_m"),
                                ("speed_mps", "speed_mps"),
                                ("heading", "heading"),
                                ("altitude_m", "altitude_m"),
                            ):
                                if data.get(k_src) is not None:
                                    try:
                                        member[k_dst] = float(data.get(k_src))
                                    except (TypeError, ValueError):
                                        pass
                            if data.get("motion") is None and member.get("speed_mps") is not None:
                                member["motion"] = _motion_from_speed(member.get("speed_mps"))
                            if member.get("heading") is not None and not member.get(
                                "heading_cardinal"
                            ):
                                member["heading_cardinal"] = _heading_cardinal(
                                    member.get("heading")
                                )
                            # time at place
                            moved = True
                            if prev_lat is not None and prev_lng is not None:
                                try:
                                    moved = (
                                        _haversine_m(
                                            float(prev_lat),
                                            float(prev_lng),
                                            lat_f,
                                            lng_f,
                                        )
                                        > PLACE_MOVE_M
                                    )
                                except (TypeError, ValueError):
                                    moved = True
                            if moved or not member.get("arrived_at"):
                                member["arrived_at"] = now
                            # home distance
                            if member.get("home_lat") is not None and member.get("home_lng") is not None:
                                try:
                                    member["dist_from_home_m"] = round(
                                        _haversine_m(
                                            float(member["home_lat"]),
                                            float(member["home_lng"]),
                                            lat_f,
                                            lng_f,
                                        )
                                    )
                                except (TypeError, ValueError):
                                    pass
                            hist = member.setdefault("history", [])
                            hist.append(
                                {
                                    "ts": now,
                                    "lat": lat_f,
                                    "lng": lng_f,
                                    "battery": member.get("battery"),
                                    "place_name": member.get("place_name") or "",
                                    "motion": member.get("motion") or "",
                                }
                            )
                            if len(hist) > MAX_HISTORY:
                                del hist[: len(hist) - MAX_HISTORY]
                    except (TypeError, ValueError):
                        pass

                # important event pushes
                name = member.get("display_name") or "Partner"
                bat = member.get("battery")
                try:
                    if bat is not None and float(bat) <= 15:
                        if prev_battery is None or float(prev_battery) > 15:
                            push_events.append(
                                (
                                    f"{name} · low battery",
                                    f"Battery at {int(float(bat))}%",
                                    {"type": "low_battery"},
                                )
                            )
                except (TypeError, ValueError):
                    pass
                if member.get("sos_active"):
                    push_events.append(
                        (
                            f"SOS from {name}",
                            member.get("sos_message") or "Needs you now",
                            {"type": "sos"},
                        )
                    )

                _save()
                pub = _pair_public(pair, mid)
                tokens = _partner_push_tokens(pair, mid)
            for title, body, pdata in push_events:
                _send_expo_push(tokens, title, body, pdata)
            self._json(200, {"ok": True, **pub})
            return

        if path == "/push-token":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            tok = _clip_str(data.get("push_token") or data.get("token"), 200)
            with _lock:
                member = (pair.get("members") or {}).get(mid)
                if not isinstance(member, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                if tok:
                    member["push_token"] = tok
                _save()
            self._json(200, {"ok": True})
            return

        if path == "/home":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            with _lock:
                member = (pair.get("members") or {}).get(mid)
                if not isinstance(member, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                if data.get("clear"):
                    member.pop("home_lat", None)
                    member.pop("home_lng", None)
                    member.pop("dist_from_home_m", None)
                else:
                    lat = data.get("lat", member.get("lat"))
                    lng = data.get("lng", member.get("lng"))
                    try:
                        lat_f, lng_f = float(lat), float(lng)
                        if -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
                            member["home_lat"] = lat_f
                            member["home_lng"] = lng_f
                            if member.get("lat") is not None:
                                member["dist_from_home_m"] = round(
                                    _haversine_m(
                                        lat_f,
                                        lng_f,
                                        float(member["lat"]),
                                        float(member["lng"]),
                                    )
                                )
                    except (TypeError, ValueError):
                        self._json(400, {"error": "Need valid lat/lng for home"})
                        return
                _save()
                pub = _pair_public(pair, mid)
            self._json(200, {"ok": True, **pub})
            return

        if path == "/care/note":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            note = _clip_str(data.get("note") or data.get("text"), 280)
            if not note:
                self._json(400, {"error": "Empty note"})
                return
            with _lock:
                me = (pair.get("members") or {}).get(mid)
                partner = None
                for did, d in (pair.get("members") or {}).items():
                    if did != mid:
                        partner = d
                        break
                if not isinstance(me, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                me["note_count"] = int(me.get("note_count") or 0) + 1
                if partner is not None:
                    partner["love_note"] = note
                    partner["love_note_at"] = _now()
                    partner["love_note_from"] = me.get("display_name") or "Partner"
                tokens = _partner_push_tokens(pair, mid)
                name = me.get("display_name") or "Partner"
                _save()
                pub = _pair_public(pair, mid)
            _send_expo_push(tokens, f"💕 Note from {name}", note, {"type": "love_note"})
            self._json(200, {"ok": True, **pub})
            return

        if path == "/care/ping":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            with _lock:
                me = (pair.get("members") or {}).get(mid)
                partner = None
                for did, d in (pair.get("members") or {}).items():
                    if did != mid:
                        partner = d
                        break
                if not isinstance(me, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                me["ping_count"] = int(me.get("ping_count") or 0) + 1
                if partner is not None:
                    partner["thinking_of_you_at"] = _now()
                tokens = _partner_push_tokens(pair, mid)
                name = me.get("display_name") or "Partner"
                _save()
                pub = _pair_public(pair, mid)
            _send_expo_push(
                tokens,
                f"{name} is thinking of you",
                "Tap to open WithYou 💗",
                {"type": "ping"},
            )
            self._json(200, {"ok": True, **pub})
            return

        if path == "/care/sos":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            active = bool(data.get("active", True))
            msg = _clip_str(data.get("message") or "I need you — please check on me", 160)
            with _lock:
                me = (pair.get("members") or {}).get(mid)
                if not isinstance(me, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                me["sos_active"] = active
                me["sos_message"] = msg if active else ""
                me["sos_at"] = _now() if active else None
                tokens = _partner_push_tokens(pair, mid)
                name = me.get("display_name") or "Partner"
                _save()
                pub = _pair_public(pair, mid)
            if active:
                _send_expo_push(tokens, f"🚨 SOS from {name}", msg, {"type": "sos"})
            self._json(200, {"ok": True, **pub})
            return

        if path == "/care/activity":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            with _lock:
                me = (pair.get("members") or {}).get(mid)
                if not isinstance(me, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                me["activity"] = _clip_str(data.get("activity"), 32)
                _save()
                pub = _pair_public(pair, mid)
            self._json(200, {"ok": True, **pub})
            return

        if path == "/pair/leave":
            auth = self._auth_device()
            if not auth:
                self._json(401, {"error": "Unauthorized"})
                return
            mid, _member, pair = auth
            token = (self.headers.get("Authorization") or "").strip()
            with _lock:
                members = pair.get("members") or {}
                members.pop(mid, None)
                _db["devices"].pop(token, None)
                if not members:
                    _db["pairs"].pop(pair.get("pair_id"), None)
                _save()
            self._json(200, {"ok": True})
            return

        self._json(404, {"error": "Not found", "path": path})


def main() -> None:
    _load()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    _log(f"listening on http://{HOST}:{PORT}")
    _log(f"data file: {DATA_FILE}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
