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
| Public `https://crew.kingdom.forum/withyou` | OK (Cloudflare path added) |
| Pair create / join / heartbeat | Smoke-tested |
| EAS Android APK | **Blocked** — Expo free Android builds used this month (resets ~Aug 1) |
| EAS iOS IPA | Needs **interactive** Apple credentials (paid Apple Dev for device IPA) |
| Use now | **Expo Go** on both phones (same Wi‑Fi or public URL) |

### Build when quota allows

```bat
cd withyou-app
npx eas-cli build -p android --profile apk
npx eas-cli build -p ios --profile preview
```

Project: https://expo.dev/accounts/tenslaster/projects/withyou

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
