# WithYou — private couple app (Love8-style, richer)

Separate from **Commander PRO**. Only **two devices** can pair. Data stays on **your PC** (+ Cloudflare tunnel).

## Features (v1)

| Feature | Details |
|--------|---------|
| **Location** | Live GPS when permission granted (background on real APK/IPA) |
| **Battery** | % + charging + low-power mode |
| **Last seen / online** | Online if heartbeat &lt; ~2 min |
| **Distance** | Between you and partner (meters / km) |
| **Map** | Both pins |
| **Mood + status** | Short text you both see |
| **Days together** | Counter from pair creation |
| **Network / platform / speed** | Extra context Love8-style |
| **Invite code** | Create pair → share code → partner joins |

## Status checklist

| Piece | Status |
|--------|--------|
| API local `:9610` | OK when `server\start.bat` is running |
| Public `https://crew.kingdom.forum/withyou` | **PWA + API** (open in Safari on iPhone) |
| Pair create / join / heartbeat | Smoke-tested |
| Android APK | `dist/WithYou.apk` + GitHub Actions `android-apk.yml` |
| iOS IPA (GitHub) | **Disabled** — kept failing / email spam |
| **iPhone now** | **PWA**: Safari → Share → Add to Home Screen (see `docs/IPHONE_PWA.md`) |
| EAS iOS IPA | Needs paid Apple Dev + interactive credentials |

### iPhone (recommended — free, no IPA)

1. Start the API (`server\start.bat`) + Cloudflare `/withyou`
2. On iPhone Safari open: **https://crew.kingdom.forum/withyou**
3. Share → **Add to Home Screen**

Full guide: [docs/IPHONE_PWA.md](docs/IPHONE_PWA.md)

## Run API (Windows)

```bat
cd C:\Users\cedri\OneDrive\Bureau\RADIOS\WithYou\server
start.bat
```

Listens on **http://0.0.0.0:9610**

### Cloudflare (like radios)

Add to `C:\cloudflared\config.yml` (before the catch-all):

```yaml
  - hostname: crew.kingdom.forum
    path: /withyou
    service: http://127.0.0.1:9610
```

Restart cloudflared. App default API: `https://crew.kingdom.forum/withyou`

Local Expo override:

```bat
set EXPO_PUBLIC_WITHYOU_API=http://YOUR_LAN_IP:9610
npx expo start
```

## Run app

```bat
cd C:\Users\cedri\OneDrive\Bureau\RADIOS\WithYou\withyou-app
npm install
npx expo start
```

Open in **Expo Go**, or later build APK/IPA (EAS) with package `com.withyou.pair`.

## Privacy

- Mutual pair only (max 2 members).
- No public discovery.
- Tokens stored in SecureStore on device; pair data in `server/data/pairs.json`.

## Not Commander PRO

Different name, package id, API port (**9610**), and Cloudflare path (**/withyou**).
