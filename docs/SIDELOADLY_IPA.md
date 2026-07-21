# Real WithYou IPA → Sideloadly (free Apple ID)

## Build (GitHub Actions — manual only)

1. Open: https://github.com/Tenslaster/withyou/actions/workflows/ios-ipa.yml  
2. Click **Run workflow** → **Run workflow**  
3. Wait ~15–40 min on `macos-15`  
4. Download artifact **`WithYou-ipa-sideloadly`** → `WithYou-Sideloadly.ipa`

This workflow does **not** run on every push (avoids email spam).

## Install with Sideloadly (Windows)

1. Install [Sideloadly](https://sideloadly.io/) if needed  
2. Plug iPhone via USB, trust the computer  
3. Drag `WithYou-Sideloadly.ipa` into Sideloadly  
4. Apple ID = your **free** iCloud / Apple ID (not paid Developer Program)  
5. Start install  
6. On iPhone: **Settings → General → VPN & Device Management** → trust the developer  
7. Open **WithYou**

Re-install / re-sign about every **7 days** (free cert expiry).

## What this IPA is

| Item | Value |
|------|--------|
| Built for | Real device (`iphoneos` / arm64) |
| Signing on CI | **None** (unsigned build) |
| Final signing | **Sideloadly** with your free Apple ID |
| API URL | `https://crew.kingdom.forum/withyou` |

## If the workflow fails

Open the failed run → step **Prebuild ExpoModulesJSI** or **xcodebuild BUILD** → copy the red error.  
Do **not** re-enable old “archive + ad-hoc” experiments (iOS 18 SDK rejects ad-hoc).
