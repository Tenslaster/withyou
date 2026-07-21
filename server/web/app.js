/* WithYou PWA — same API as the mobile app, no IPA required */
(function () {
  "use strict";

  const TOKEN_KEY = "withyou_token_v1";
  const NAME_KEY = "withyou_name_v1";
  const APP_VERSION = "1.1.0-pwa";
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

  function fmtDuration(sec) {
    if (sec == null || Number.isNaN(sec)) return "—";
    const s = Math.max(0, Math.floor(sec));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }

  function motionLabel(m) {
    const map = {
      still: "Still",
      walking: "Walking",
      running_or_bike: "Running / bike",
      driving: "Driving",
      unknown: "Unknown",
    };
    return map[m] || m || "—";
  }

  async function collectTelemetry() {
    const hour = new Date().getHours();
    const body = {
      platform: "web",
      app_version: APP_VERSION,
      mood: $("mood")?.value || undefined,
      status_text: $("status-text")?.value || undefined,
      activity: $("activity")?.value || undefined,
      network: navigator.onLine ? "online" : "offline",
      is_internet: !!navigator.onLine,
      is_wifi: undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      locale: navigator.language || "",
      app_state: document.visibilityState === "visible" ? "active" : "background",
      local_hour: hour,
      day_night: hour >= 6 && hour < 20 ? "day" : "night",
      device_model: navigator.userAgentData?.model || "",
      device_brand: navigator.userAgentData?.platform || "",
      os_name: "web",
      os_version: "",
    };

    try {
      if (navigator.getBattery) {
        const bat = await navigator.getBattery();
        body.battery = Math.round(bat.level * 100);
        body.charging = !!bat.charging;
      }
    } catch {
      /* optional */
    }

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
      if (pos.coords.speed != null && pos.coords.speed >= 0) {
        body.speed_mps = pos.coords.speed;
        if (pos.coords.speed < 0.4) body.motion = "still";
        else if (pos.coords.speed < 2) body.motion = "walking";
        else if (pos.coords.speed < 8) body.motion = "running_or_bike";
        else body.motion = "driving";
      }
      if (pos.coords.heading != null && pos.coords.heading >= 0) body.heading = pos.coords.heading;
      if (pos.coords.altitude != null) body.altitude_m = pos.coords.altitude;
      try {
        const url =
          `https://api.open-meteo.com/v1/forecast?latitude=${body.lat}&longitude=${body.lng}` +
          `&current=temperature_2m,weather_code&timezone=auto`;
        const wr = await fetch(url);
        if (wr.ok) {
          const wj = await wr.json();
          if (wj?.current) {
            body.weather_temp_c = wj.current.temperature_2m;
            body.weather_code = wj.current.weather_code;
            body.weather_label = String(wj.current.weather_code);
          }
        }
      } catch {
        /* weather optional */
      }
    } catch {
      /* permission denied */
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

  function tile(label, value) {
    const v = value == null || value === "" ? "—" : String(value);
    return `<div class="tile"><div class="tile-val">${v}</div><div class="tile-lbl">${label}</div></div>`;
  }

  function personCardHtml(title, person, emptyHint) {
    if (!person) {
      return `<p class="card-title">${title}</p><p class="muted">${emptyHint}</p>`;
    }
    const pct = person.battery;
    const bc = batteryColor(pct, person.charging);
    const moodLine =
      person.mood || person.status_text || person.activity
        ? `<p class="status-line">${person.mood || ""} ${
            person.activity ? "[" + person.activity + "]" : ""
          } ${person.status_text || ""}</p>`
        : "";
    const speed =
      person.speed_kmh != null
        ? `${person.speed_kmh} km/h`
        : person.speed_mps != null
          ? `${(person.speed_mps * 3.6).toFixed(0)} km/h`
          : "—";
    const home = !person.home_set
      ? "Not set"
      : person.at_home
        ? "At home"
        : fmtDist(person.dist_from_home_m);
    return `
      <div class="card-head">
        <p class="card-title">${person.emoji || "💕"} ${person.display_name || title}</p>
        <span class="dot ${person.online ? "on" : ""}"></span>
      </div>
      <p class="meta">${person.online ? "Online" : "Offline"} · last seen ${fmtAgo(person.last_seen)}${
      person.app_state ? " · app " + person.app_state : ""
    }</p>
      <p class="batt" style="color:${bc}">🔋 ${pct != null ? Math.round(pct) + "%" : "—"}${
      person.charging ? " ⚡ charging" : ""
    }${person.low_power ? " · Low Power" : ""}</p>
      ${moodLine}
      <div class="grid">
        ${tile("Place", person.place_name || (person.lat != null ? "GPS" : "No GPS"))}
        ${tile("City", [person.place_city, person.place_region].filter(Boolean).join(", "))}
        ${tile("Time here", fmtDuration(person.time_at_place_s))}
        ${tile("Motion", motionLabel(person.motion))}
        ${tile("Speed", speed)}
        ${tile("Heading", person.heading_cardinal || "—")}
        ${tile("Altitude", person.altitude_m != null ? Math.round(person.altitude_m) + " m" : "—")}
        ${tile("Home", home)}
        ${tile("Network", person.network || "—")}
        ${tile("Cell", person.cellular_gen || "—")}
        ${tile("Carrier", person.carrier || "—")}
        ${tile("Weather", person.weather_temp_c != null ? person.weather_temp_c + "°" : "—")}
        ${tile("Day/night", person.day_night || "—")}
        ${tile("Timezone", person.timezone || "—")}
        ${tile("Device", [person.device_brand, person.device_model].filter(Boolean).join(" ") || person.platform || "—")}
        ${tile("OS", [person.os_name, person.os_version].filter(Boolean).join(" "))}
        ${tile("Traveled today", fmtDist(person.traveled_m_today))}
        ${tile("Places today", person.places_today)}
        ${tile("Pings", person.ping_count ?? 0)}
        ${tile("Notes", person.note_count ?? 0)}
      </div>
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
    const stats = pair?.stats || {};
    if ($("stats-card")) {
      $("stats-card").innerHTML =
        `<p class="card-title">Couple stats</p><div class="grid">` +
        tile("Days together", pair?.days_together) +
        tile("Now apart", fmtDist(pair?.distance_m)) +
        tile("Max apart today", fmtDist(stats.max_distance_m_today)) +
        tile("Closest today", fmtDist(stats.min_distance_m_today)) +
        tile("Care pings", stats.care_pings_total ?? 0) +
        tile("Love notes", stats.love_notes_total ?? 0) +
        tile("Both online", stats.both_online ? "Yes" : "No") +
        tile("Partner places", partner?.places_today ?? "—") +
        `</div>`;
    }
    const alerts = $("care-alerts");
    if (alerts) {
      let html = "";
      if (partner?.sos_active) {
        html += `<div class="banner sos"><strong>🚨 PARTNER SOS</strong><span>${
          partner.sos_message || "Needs you"
        }</span></div>`;
      }
      if (me?.love_note) {
        html += `<div class="banner"><strong>💕 Note from ${
          me.love_note_from || "partner"
        }</strong><span>${me.love_note}</span></div>`;
      }
      if (me?.thinking_of_you_at) {
        html += `<div class="banner"><strong>💗 Thinking of you</strong><span>Pinged ${fmtAgo(
          me.thinking_of_you_at
        )}</span></div>`;
      }
      alerts.innerHTML = html;
    }
    if (me?.mood != null && document.activeElement !== $("mood")) {
      $("mood").value = me.mood || "";
    }
    if (me?.status_text != null && document.activeElement !== $("status-text")) {
      $("status-text").value = me.status_text || "";
    }
    if (me?.activity != null && $("activity") && document.activeElement !== $("activity")) {
      $("activity").value = me.activity || "";
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
    const name = $("name").value.trim() || "Me";
    const emoji = $("emoji").value.trim() || "💙";
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
    // Name optional — only invite code is required
    const name = $("name").value.trim() || "Partner";
    const invite = cleanInvite($("invite").value);
    $("invite").value = invite;
    const emoji = $("emoji").value.trim() || "💗";
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

  async function sendPing() {
    try {
      const data = await api("/care/ping", { method: "POST", body: {} });
      pair = data;
      renderMain();
      alert("Sent 💗 Thinking of you");
    } catch (e) {
      alert(e.message || "Ping failed");
    }
  }
  async function sendNote() {
    const note = ($("love-note")?.value || "").trim();
    if (!note) {
      alert("Type a note first");
      return;
    }
    try {
      const data = await api("/care/note", { method: "POST", body: { note } });
      pair = data;
      $("love-note").value = "";
      renderMain();
      alert("Love note sent 💕");
    } catch (e) {
      alert(e.message || "Note failed");
    }
  }
  async function sendSos() {
    const active = !pair?.me?.sos_active;
    if (active && !confirm("Send SOS to partner?")) return;
    try {
      const data = await api("/care/sos", {
        method: "POST",
        body: {
          active,
          message: "I need you — please check on me",
        },
      });
      pair = data;
      renderMain();
    } catch (e) {
      alert(e.message || "SOS failed");
    }
  }
  async function setHome() {
    try {
      const data = await api("/home", {
        method: "POST",
        body: { lat: pair?.me?.lat, lng: pair?.me?.lng },
      });
      pair = data;
      renderMain();
      heartbeat();
      alert("Home saved");
    } catch (e) {
      alert(e.message || "Need GPS first");
    }
  }

  $("btn-create").addEventListener("click", createPair);
  $("btn-join").addEventListener("click", joinPair);
  $("btn-leave").addEventListener("click", leavePair);
  $("btn-update").addEventListener("click", heartbeat);
  $("btn-ping")?.addEventListener("click", sendPing);
  $("btn-note")?.addEventListener("click", sendNote);
  $("btn-sos")?.addEventListener("click", sendSos);
  $("btn-home")?.addEventListener("click", setHome);
  $("activity")?.addEventListener("change", async () => {
    try {
      const data = await api("/care/activity", {
        method: "POST",
        body: { activity: $("activity").value },
      });
      pair = data;
      renderMain();
    } catch {
      /* ignore */
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && token) heartbeat();
  });

  // Service worker (optional offline shell)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  bootSession();
})();
