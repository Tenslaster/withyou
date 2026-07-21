# Sign WithYou **without** a paid Apple Developer account ($99)

## Important distinction

| What | Cost | Works? |
|------|------|--------|
| **Paid Apple Developer Program** | $99/year | App Store, TestFlight, long-lived certs |
| **Free Apple ID** (iCloud email) | Free | **Yes** — Sideloadly / SideStore / AltStore re-sign for **7 days**, then re-sign |
| **No Apple ID at all** | — | **Cannot** install custom IPA on a normal non-jailbroken iPhone |

Apple does **not** allow permanent custom installs with zero Apple identity.  
What you *can* do free: use a normal **free Apple ID** (no Developer Program enrollment).

---

## Android APK (already done — no Google account needed)

File:

`RADIOS\WithYou\dist\WithYou.apk`

Signed with a **local debug key** (not Play Store). Install:

1. Transfer APK to phone  
2. Allow “Install unknown apps”  
3. Open APK  

---

## iPhone — free method: **Sideloadly** + free Apple ID

### 1. Get Sideloadly (Windows)

https://sideloadly.io/

### 2. Free Apple ID

- Any free Apple ID (iCloud / Gmail linked to Apple)  
- **Do not** need to pay $99  
- May need 2FA: app-specific password if Sideloadly asks  
  https://appleid.apple.com → Sign-In and Security → App-Specific Passwords  

### 3. Install the IPA

1. Plug iPhone into PC (USB), trust computer  
2. Open Sideloadly  
3. Select IPA (when CI produces it, or any unsigned/ad-hoc IPA)  
4. Enter free Apple ID + password (or app-specific password)  
5. Start — Sideloadly **re-signs** with a free 7-day cert and installs  

### 4. Trust the app on iPhone

Settings → General → VPN & Device Management → your Apple ID → **Trust**

### 5. Every ~7 days

Re-open Sideloadly and install again (same IPA) — free certs expire weekly.

### Optional: SideStore / AltStore

Same idea (free Apple ID, 7-day refresh). SideStore can refresh over Wi‑Fi with a pair of free “app slots” (limit 3 free apps).

---

## What “dev account” means here

- **You do NOT need** the paid Developer Program for personal WithYou install.  
- **You DO need** a free Apple ID for Sideloadly.  
- Paid account only if you want App Store / permanent certs / >3 free apps.

---

## Jailbreak / TrollStore (optional)

If the device supports **TrollStore**, permanent install of unsigned IPAs is possible without re-signing. Only for specific iOS versions — not the default path.

---

## Security note

Use a **dedicated free Apple ID** for sideloading (not your main bank/iCloud if you prefer isolation). Never commit Apple passwords to GitHub.
