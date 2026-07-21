# WithYou on iPhone — **no IPA**, no GitHub emails

GitHub Actions cannot build a free Sideloadly IPA reliably (Xcode / signing failures).  
That workflow is **disabled**. Use the **web app (PWA)** instead.

## One-time install (looks like an app)

1. On the **iPhone**, open **Safari** (not Chrome)
2. Go to: **https://crew.kingdom.forum/withyou**
3. Wait for the WithYou screen (name + Create / Join)
4. Tap the **Share** button (square with arrow)
5. Scroll and tap **Add to Home Screen**
6. Tap **Add**
7. Open the **WithYou** icon on the home screen

Allow **Location** when asked (so your partner sees you on the map).

## Partner

Same link → same steps → one creates a pair (gets a code) → the other joins with that code.

## Android

- Prefer the real APK: `dist/WithYou.apk` (or GitHub Actions artifact)
- Or open the same URL in Chrome → “Install app” / Add to Home screen

## What works in the PWA

| Feature | iPhone Safari / Home Screen |
|--------|-----------------------------|
| Create / join pair | Yes |
| Live map + distance | Yes (while app/tab is open) |
| Partner battery / mood / last seen | Yes |
| Your GPS share | Yes (when permission granted) |
| Your battery % | Often **no** on iOS (browser API blocked) |
| Background GPS when phone locked | Limited (iOS freezes background tabs) |

For full background tracking you still need a real native app (paid Apple Developer + EAS/IPA). The PWA is the free path that works **today**.

## API must be running

On your PC:

```bat
cd C:\Users\cedri\OneDrive\Bureau\RADIOS\WithYou\server
start.bat
```

Cloudflare tunnel must route `/withyou` → `http://127.0.0.1:9610`.

Health check: `https://crew.kingdom.forum/withyou/health`
