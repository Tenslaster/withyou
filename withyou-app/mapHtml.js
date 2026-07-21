/**
 * In-app Leaflet / OpenStreetMap HTML for Android (and fallback).
 * Looks like a real product map without Google Maps API key or native crashes.
 */
function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {{
 *  me?: { lat?: number, lng?: number, name?: string, color?: string },
 *  partner?: { lat?: number, lng?: number, name?: string, color?: string },
 *  trail?: Array<{ lat: number, lng: number }>,
 *  distanceLabel?: string,
 * }} opts
 */
export function buildMapHtml(opts = {}) {
  const me = opts.me || {};
  const partner = opts.partner || {};
  const trail = Array.isArray(opts.trail) ? opts.trail : [];
  const dist = opts.distanceLabel || '—';

  const points = [];
  if (me.lat != null && me.lng != null) {
    points.push([Number(me.lat), Number(me.lng)]);
  }
  if (partner.lat != null && partner.lng != null) {
    points.push([Number(partner.lat), Number(partner.lng)]);
  }
  for (const t of trail) {
    if (t && t.lat != null && t.lng != null) points.push([Number(t.lat), Number(t.lng)]);
  }

  let centerLat = 45.5;
  let centerLng = -73.6;
  let zoom = 12;
  if (points.length === 1) {
    centerLat = points[0][0];
    centerLng = points[0][1];
    zoom = 14;
  } else if (points.length > 1) {
    centerLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    centerLng = points.reduce((s, p) => s + p[1], 0) / points.length;
    zoom = 12;
  }

  const meJson = JSON.stringify({
    lat: me.lat != null ? Number(me.lat) : null,
    lng: me.lng != null ? Number(me.lng) : null,
    name: me.name || 'You',
  });
  const partnerJson = JSON.stringify({
    lat: partner.lat != null ? Number(partner.lat) : null,
    lng: partner.lng != null ? Number(partner.lng) : null,
    name: partner.name || 'Partner',
  });
  const trailJson = JSON.stringify(
    trail
      .filter((t) => t && t.lat != null && t.lng != null)
      .map((t) => [Number(t.lat), Number(t.lng)])
  );

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin: 0; padding: 0; height: 100%; width: 100%; background: #0b0810; }
    .leaflet-control-attribution { font-size: 9px !important; background: rgba(15,10,18,.75) !important; color: #94a3b8 !important; }
    .leaflet-control-attribution a { color: #f472b6 !important; }
    .badge {
      position: absolute; z-index: 1000; top: 10px; left: 10px;
      background: rgba(22,18,31,.92); color: #f472b6; border: 1px solid rgba(244,114,182,.35);
      font: 700 11px -apple-system, BlinkMacSystemFont, sans-serif;
      padding: 6px 10px; border-radius: 999px; letter-spacing: .02em;
    }
    .pin {
      width: 16px; height: 16px; border-radius: 50%;
      border: 2.5px solid #fff; box-shadow: 0 2px 8px rgba(0,0,0,.45);
    }
    .pin.me { background: #38bdf8; }
    .pin.partner { background: #f472b6; }
  </style>
</head>
<body>
  <div class="badge">${esc(dist)} apart</div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function () {
      var me = ${meJson};
      var partner = ${partnerJson};
      var trail = ${trailJson};
      var map = L.map('map', {
        zoomControl: true,
        attributionControl: true
      }).setView([${centerLat}, ${centerLng}], ${zoom});

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; OSM &copy; CARTO'
      }).addTo(map);

      function mkIcon(cls) {
        return L.divIcon({
          className: '',
          html: '<div class="pin ' + cls + '"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
      }

      var bounds = [];
      if (trail && trail.length > 1) {
        L.polyline(trail, { color: '#f472b6', weight: 3, opacity: 0.65 }).addTo(map);
        trail.forEach(function (p) { bounds.push(p); });
      }
      if (me.lat != null && me.lng != null) {
        L.marker([me.lat, me.lng], { icon: mkIcon('me') })
          .addTo(map).bindPopup(me.name || 'You');
        bounds.push([me.lat, me.lng]);
      }
      if (partner.lat != null && partner.lng != null) {
        L.marker([partner.lat, partner.lng], { icon: mkIcon('partner') })
          .addTo(map).bindPopup(partner.name || 'Partner');
        bounds.push([partner.lat, partner.lng]);
      }
      if (bounds.length > 1) {
        try { map.fitBounds(bounds, { padding: [36, 36], maxZoom: 15 }); } catch (e) {}
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 14);
      }
    })();
  </script>
</body>
</html>`;
}
