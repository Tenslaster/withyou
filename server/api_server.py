#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WithYou pair API — private couple location / battery / presence.

Default: http://0.0.0.0:9610
Cloudflare: path /withyou → http://127.0.0.1:9610  (or hostname)

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
WEB_DIR = Path(__file__).resolve().parent / "web"

# Static PWA assets (no IPA needed — iPhone: Safari → Share → Add to Home Screen)
_WEB_MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".map": "application/json",
}
_WEB_FILES = {
    "/": "index.html",
    "/app": "index.html",
    "/index.html": "index.html",
    "/app.js": "app.js",
    "/sw.js": "sw.js",
    "/manifest.webmanifest": "manifest.webmanifest",
    "/manifest.json": "manifest.webmanifest",
    "/icon-192.png": "icon-192.png",
    "/icon-512.png": "icon-512.png",
}
MAX_HISTORY = 40
HEARTBEAT_STALE_S = 120  # >2 min without beat → offline

_lock = threading.RLock()
_db: dict[str, Any] = {"pairs": {}, "devices": {}}


def _log(msg: str) -> None:
    print(f"[WithYou] {msg}", flush=True)


def _now() -> float:
    return time.time()


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
    online = (_now() - last) <= HEARTBEAT_STALE_S if last else False
    out = {
        "device_id": d.get("device_id"),
        "display_name": d.get("display_name") or "Partner",
        "emoji": d.get("emoji") or "💕",
        "last_seen": last or None,
        "online": online,
        "battery": d.get("battery"),
        "charging": bool(d.get("charging")),
        "lat": d.get("lat"),
        "lng": d.get("lng"),
        "accuracy_m": d.get("accuracy_m"),
        "speed_mps": d.get("speed_mps"),
        "heading": d.get("heading"),
        "altitude_m": d.get("altitude_m"),
        "network": d.get("network") or "",
        "platform": d.get("platform") or "",
        "app_version": d.get("app_version") or "",
        "mood": d.get("mood") or "",
        "status_text": d.get("status_text") or "",
        "low_power": bool(d.get("low_power")),
    }
    return out


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
    return {
        "pair_id": pair.get("pair_id"),
        "invite_code": pair.get("invite_code"),
        "together_since": together_since,
        "days_together": days,
        "me": _public_device(me),
        "partner": _public_device(partner) if partner else None,
        "distance_m": dist,
        "partner_joined": partner is not None,
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

    def _serve_web(self, path: str, *, under_withyou: bool = False) -> bool:
        """Serve PWA static files. Returns True if handled."""
        key = path if path.startswith("/") else f"/{path}"
        if key != "/" and key.endswith("/"):
            key = key.rstrip("/") or "/"
        # Accept: application/json on / → health for probes / mobile app
        if key in ("/", "/app"):
            accept = (self.headers.get("Accept") or "").lower()
            if "application/json" in accept and "text/html" not in accept:
                return False
        rel = _WEB_FILES.get(key)
        if not rel:
            name = key.lstrip("/")
            if name and ".." not in name and "/" not in name:
                candidate = WEB_DIR / name
                if candidate.is_file():
                    rel = name
        if not rel:
            return False
        fpath = WEB_DIR / rel
        if not fpath.is_file():
            return False
        try:
            data = fpath.read_bytes()
        except OSError:
            return False
        # Fix relative assets when public URL is /withyou (no trailing slash)
        if rel == "index.html" and under_withyou:
            base = b'<base href="/withyou/">'
            data = data.replace(b"<head>", b"<head>\n  " + base, 1)
        ctype = _WEB_MIME.get(fpath.suffix.lower(), "application/octet-stream")
        if rel == "sw.js":
            cache = "no-cache"
        elif fpath.suffix.lower() in (".png", ".svg", ".ico"):
            cache = "public, max-age=86400"
        else:
            cache = "no-cache"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", cache)
        if rel == "sw.js":
            self.send_header(
                "Service-Worker-Allowed",
                "/withyou/" if under_withyou else "/",
            )
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_GET(self) -> None:  # noqa: N802
        raw_path = urlparse(self.path).path
        path = raw_path.rstrip("/") or "/"
        under_withyou = path.startswith("/withyou")
        # Allow both /withyou/* and /* (tunnel strip or not)
        if under_withyou:
            path = path[len("/withyou") :] or "/"

        # PWA (browser) — iPhone: Safari → Share → Add to Home Screen
        if path not in ("/health", "/me", "/partner", "/history"):
            if self._serve_web(path, under_withyou=under_withyou):
                return

        if path in ("/health",):
            self._json(
                200,
                {
                    "ok": True,
                    "service": "withyou",
                    "version": "1.0.0",
                    "pwa": True,
                    "time": _now(),
                },
            )
            return

        # JSON health for API clients that still hit /
        if path == "/":
            accept = (self.headers.get("Accept") or "").lower()
            if "application/json" in accept:
                self._json(
                    200,
                    {
                        "ok": True,
                        "service": "withyou",
                        "version": "1.0.0",
                        "pwa": True,
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
            code = re.sub(r"[^A-Fa-f0-9]", "", str(data.get("invite_code") or "")).upper()
            name = str(data.get("display_name") or "Partner").strip()[:32] or "Partner"
            emoji = str(data.get("emoji") or "💗").strip()[:8] or "💗"
            platform = str(data.get("platform") or "").strip()[:16]
            if len(code) < 4:
                self._json(400, {"error": "Invalid invite code"})
                return
            with _lock:
                pair = None
                for p in _db["pairs"].values():
                    if str(p.get("invite_code") or "").upper() == code:
                        pair = p
                        break
                if not pair:
                    self._json(404, {"error": "Invite not found"})
                    return
                members = pair.setdefault("members", {})
                if len(members) >= 2:
                    self._json(409, {"error": "Pair already full (2 devices max)"})
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
            with _lock:
                member = (pair.get("members") or {}).get(mid)
                if not isinstance(member, dict):
                    self._json(401, {"error": "Unauthorized"})
                    return
                now = _now()
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
                # location
                lat = data.get("lat")
                lng = data.get("lng")
                if lat is not None and lng is not None:
                    try:
                        lat_f, lng_f = float(lat), float(lng)
                        if -90 <= lat_f <= 90 and -180 <= lng_f <= 180:
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
                            hist = member.setdefault("history", [])
                            hist.append(
                                {
                                    "ts": now,
                                    "lat": lat_f,
                                    "lng": lng_f,
                                    "battery": member.get("battery"),
                                }
                            )
                            if len(hist) > MAX_HISTORY:
                                del hist[: len(hist) - MAX_HISTORY]
                    except (TypeError, ValueError):
                        pass
                if data.get("network") is not None:
                    member["network"] = str(data.get("network"))[:32]
                if data.get("platform") is not None:
                    member["platform"] = str(data.get("platform"))[:16]
                if data.get("app_version") is not None:
                    member["app_version"] = str(data.get("app_version"))[:24]
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
