# WithYou downloads (website)

Commander PRO stays at `/downloads` only.  
**WithYou** is only on its own page:

| What | URL |
|------|-----|
| **Install page** | https://crew.kingdom.forum/withyou |
| **APK** | https://crew.kingdom.forum/withyou/install/apk |
| **IPA** (Sideloadly) | https://crew.kingdom.forum/withyou/install/ipa |
| **Alt download page** | https://crew.kingdom.forum/downloads/withyou |

**No web/PWA app** — Android APK and iPhone IPA only.

`/downloads` (root) = Commander PRO only.

## Local files

```
RADIOS\WithYou\dist\WithYou.apk   (~69 MB)
RADIOS\WithYou\dist\WithYou.ipa   (~8.5 MB)
```

## Install IPA

1. Open https://crew.kingdom.forum/downloads/withyou  
2. Download IPA → **Sideloadly** + free Apple ID  
3. Trust developer on iPhone · re-sign every ~7 days  

## Keep servers running

- **Download server** `:8787` — `AppIPhone\iphone-batch-manager\scripts\start-download-server.bat`  
- Cloudflare path `/downloads` → `:8787`  
- WithYou API `:9610` is the app/API only (not the installer page)  
