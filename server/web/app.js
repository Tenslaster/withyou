/* WithYou PWA — same API as the mobile app, no IPA required */
(function () {
  "use strict";

  const TOKEN_KEY = "withyou_token_v1";
  const NAME_KEY = "withyou_name_v1";
  const APP_VERSION = "1.0.0-pwa";
  const POLL_MS = 12000;
  const HEARTBEAT_MS = 20000;

  /** API base: /withyou when behind CF path, else same origin (local :9610) */
  function apiBase() {
    const path = (location.pathname || "/").replace(/\/+$/, "") || "";
    if (path === "/withyou" || path.startsWith("/withyou/")) {
      return location.origin + "/withyou";
    }
    // served as / or /app from local API
    return location.origin;
  }

  const API = apiBase();

  const $ = (id) => document.getElementById(id);
  const boot = $("boot");
  const pairScreen = $("pair-screen");
  const mainScreen = $("main-screen");

  let token = null;
  let pair = null;
  let map = null;
  let meMarker = null;
  let partnerMarker = null;
  let timers = [];

  function fmtDist(m) {
    if (m == null || Number.isNaN(m)) return "—";
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  }

  function fmtAgo(ts) {
    if (!ts) return "never";
    const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
    if (s < 15) return "just now";
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function batteryColor(pct, charging) {
    if (charging) return "#34d399";
    if (pct == null) return "#94a3b8";
    if (pct <= 15) return "#f87171";
    if (pct <= 30) return "#fbbf24";
    return "#38bdf8";
  }

  async function api(path, { method = "GET", body } = {}) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `WithYou/${APP_VERSION} (web)`,
      "X-App-Version": APP_VERSION,
    };
    if (token) headers.Authorization = token;
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: text || res.statusText };
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function show(el) {
    el.classList.remove("hidden");
  }
  function hide(el) {
    el.classList.add("hidden");
  }

  function isIos() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  }

  async function collectTelemetry() {
    const body = {
      platform: "web",
      app_version: APP_VERSION,
      mood: $("mood")?.value || undefined,
      status_text: $("status-text")?.value || undefined,
      network: navigator.onLine ? "online" : "offline",
    };

    // Battery Status API (Chrome/Android; often missing on iOS Safari)
    try {
      if (navigator.getBattery) {
        const bat = await navigator.getBattery();
        body.battery = Math.round(bat.level * 100);
        body.charging = !!bat.charging;
      }
    } catch {
      /* optional */
    }

    // Geolocation
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("no geo"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 15000,
          timeout: 20000,
        });
      });
      body.lat = pos.coords.latitude;
      body.lng = pos.coords.longitude;
      if (pos.coords.accuracy != null) body.accuracy_m = pos.coords.accuracy;
      if (pos.coords.speed != null && pos.coords.speed >= 0) body.speed_mps = pos.coords.speed;
      if (pos.coords.heading != null && pos.coords.heading >= 0) body.heading = pos.coords.heading;
      if (pos.coords.altitude != null) body.altitude_m = pos.coords.altitude;
    } catch {
      /* permission denied or unavailable */
    }
    return body;
  }

  async function heartbeat() {
    if (!token) return;
    try {
      const body = await collectTelemetry();
      const data = await api("/heartbeat", { method: "POST", body });
      if (data?.ok) {
        pair = data;
        renderMain();
      }
      $("main-err").textContent = "";
    } catch (e) {
      $("main-err").textContent = e.message || "Sync failed";
    }
  }

  async function refresh() {
    if (!token) return;
    try {
      const data = await api("/me");
      pair = data;
      renderMain();
      $("main-err").textContent = "";
    } catch (e) {
      $("main-err").textContent = e.message || "Refresh failed";
    }
  }

  function personCardHtml(title, person, emptyHint) {
    if (!person) {
      return `<p class="card-title">${title}</p><p class="muted">${emptyHint}</p>`;
    }
    const pct = person.battery;
    const bc = batteryColor(pct, person.charging);
    const moodLine =
      person.mood || person.status_text
        ? `<p class="status-line">${person.mood || ""}${
            person.mood && person.status_text ? " — " : ""
          }${person.status_text || ""}</p>`
        : "";
    const coords =
      person.lat != null
        ? `${Number(person.lat).toFixed(5)}, ${Number(person.lng).toFixed(5)}`
        : "No GPS yet";
    const speed =
      person.speed_mps != null && person.speed_mps > 0.5
        ? ` · ${(person.speed_mps * 3.6).toFixed(0)} km/h`
        : "";
    return `
      <div class="card-head">
        <p class="card-title">${person.emoji || "💕"} ${person.display_name || title}</p>
        <span class="dot ${person.online ? "on" : ""}"></span>
      </div>
      <p class="meta">${person.online ? "Online" : "Offline"} · last seen ${fmtAgo(person.last_seen)}</p>
      <p class="batt" style="color:${bc}">🔋 ${pct != null ? Math.round(pct) + "%" : "—"}${
      person.charging ? " ⚡" : ""
    }${person.low_power ? " · Low Power" : ""}</p>
      ${moodLine}
      <p class="meta">${coords}${
      person.accuracy_m != null ? ` · ±${Math.round(person.accuracy_m)}m` : ""
    }</p>
      <p class="meta">${person.platform || "—"}${
      person.network ? ` · ${person.network}` : ""
    }${speed}${person.app_version ? ` · v${person.app_version}` : ""}</p>
    `;
  }

  function ensureMap() {
    if (map) return;
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView(
      [48.8566, 2.3522],
      12
    );
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);
  }

  function updateMap() {
    ensureMap();
    const me = pair?.me;
    const partner = pair?.partner;
    const pts = [];

    if (me?.lat != null && me?.lng != null) {
      const ll = [me.lat, me.lng];
      pts.push(ll);
      if (!meMarker) {
        meMarker = L.marker(ll, { title: "You" }).addTo(map).bindPopup("You");
      } else {
        meMarker.setLatLng(ll);
      }
    }
    if (partner?.lat != null && partner?.lng != null) {
      const ll = [partner.lat, partner.lng];
      pts.push(ll);
      if (!partnerMarker) {
        partnerMarker = L.circleMarker(ll, {
          radius: 10,
          color: "#f472b6",
          fillColor: "#f472b6",
          fillOpacity: 0.9,
        })
          .addTo(map)
          .bindPopup(partner.display_name || "Partner");
      } else {
        partnerMarker.setLatLng(ll);
      }
    }

    if (pts.length === 1) {
      map.setView(pts[0], 14);
    } else if (pts.length === 2) {
      map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
    }
    setTimeout(() => map.invalidateSize(), 100);
  }

  function renderMain() {
    const me = pair?.me;
    const partner = pair?.partner;
    const code = pair?.invite_code || "";
    $("days-line").textContent =
      (pair?.days_together != null ? `${pair.days_together} days together` : "—") +
      (code ? ` · code ${code}` : "");
    if (!pair?.partner_joined && !partner) {
      show($("wait-banner"));
      $("invite-code").textContent = code || "—";
    } else {
      hide($("wait-banner"));
    }
    $("dist-val").textContent = fmtDist(pair?.distance_m);
    $("partner-card").innerHTML = personCardHtml("Partner", partner, "Not joined yet");
    $("me-card").innerHTML = personCardHtml("You", me, "Share location to appear");
    if (me?.mood != null && document.activeElement !== $("mood")) {
      $("mood").value = me.mood || "";
    }
    if (me?.status_text != null && document.activeElement !== $("status-text")) {
      $("status-text").value = me.status_text || "";
    }
    updateMap();
    $("footer-hint").textContent = `Web PWA · v${APP_VERSION} · API ${API}\nKeep Safari open (or Home Screen app) for live updates.`;
  }

  function clearTimers() {
    timers.forEach(clearInterval);
    timers = [];
  }

  function startLoops() {
    clearTimers();
    heartbeat();
    timers.push(setInterval(() => {
      if (document.visibilityState === "visible") heartbeat();
    }, HEARTBEAT_MS));
    timers.push(setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS));
  }

  function goPairScreen() {
    clearTimers();
    hide(boot);
    hide(mainScreen);
    show(pairScreen);
    $("api-hint").textContent = `API: ${API}\nData stays on your server. Mutual consent only.`;
    if (isIos() && !isStandalone()) {
      show($("install-tip"));
    } else {
      hide($("install-tip"));
    }
  }

  function goMain() {
    hide(boot);
    hide(pairScreen);
    show(mainScreen);
    renderMain();
    startLoops();
  }

  async function createPair() {
    const name = $("name").value.trim();
    const emoji = $("emoji").value.trim() || "💙";
    if (!name) {
      $("pair-err").textContent = "Enter your name first.";
      show($("pair-err"));
      return;
    }
    $("btn-create").disabled = true;
    hide($("pair-err"));
    try {
      const data = await api("/pair/create", {
        method: "POST",
        body: { display_name: name, emoji, platform: "web" },
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(NAME_KEY, name);
      pair = {
        me: data.me,
        partner: data.partner,
        invite_code: data.invite_code,
        days_together: data.days_together ?? 0,
        distance_m: null,
        partner_joined: false,
      };
      goMain();
    } catch (e) {
      $("pair-err").textContent = e.message || "Create failed";
      show($("pair-err"));
    } finally {
      $("btn-create").disabled = false;
    }
  }

  function cleanInvite(raw) {
    return String(raw || "")
      .toUpperCase()
      .replace(/[^A-F0-9]/g, "")
      .slice(0, 8);
  }

  async function joinPair() {
    const name = $("name").value.trim();
    const invite = cleanInvite($("invite").value);
    $("invite").value = invite;
    const emoji = $("emoji").value.trim() || "💗";
    if (!name) {
      $("pair-err").textContent = "Type your name first (e.g. Alex).";
      show($("pair-err"));
      return;
    }
    if (!invite || invite.length < 4) {
      $("pair-err").textContent =
        "Type the 6-character invite code from your partner (Create pair).";
      show($("pair-err"));
      return;
    }
    $("btn-join").disabled = true;
    hide($("pair-err"));
    try {
      const data = await api("/pair/join", {
        method: "POST",
        body: {
          invite_code: invite,
          display_name: name,
          emoji,
          platform: "web",
        },
      });
      token = data.token;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(NAME_KEY, name);
      pair = data;
      goMain();
    } catch (e) {
      $("pair-err").textContent = e.message || "Join failed";
      show($("pair-err"));
    } finally {
      $("btn-join").disabled = false;
    }
  }

  async function leavePair() {
    if (!confirm("Leave pair? You will stop sharing with your partner.")) return;
    try {
      if (token) await api("/pair/leave", { method: "POST", body: {} });
    } catch {
      /* ignore */
    }
    token = null;
    pair = null;
    localStorage.removeItem(TOKEN_KEY);
    clearTimers();
    goPairScreen();
  }

  async function bootSession() {
    $("api-hint").textContent = `API: ${API}`;
    const savedName = localStorage.getItem(NAME_KEY);
    if (savedName) $("name").value = savedName;
    const t = localStorage.getItem(TOKEN_KEY);
    if (t) {
      token = t;
      try {
        const data = await api("/me");
        pair = data;
        goMain();
        return;
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        token = null;
      }
    }
    goPairScreen();
  }

  $("btn-create").addEventListener("click", createPair);
  $("btn-join").addEventListener("click", joinPair);
  $("btn-leave").addEventListener("click", leavePair);
  $("btn-update").addEventListener("click", heartbeat);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token) heartbeat();
  });

  // Service worker (optional offline shell)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  bootSession();
})();
