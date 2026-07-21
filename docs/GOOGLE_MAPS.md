# Google Maps in WithYou (optional)

By default **Android** uses a professional **in-app map** (OpenStreetMap / Carto dark tiles via WebView).  
No API key required and it does not crash.

**iPhone** uses the native Apple Map.

## Optional: true Google Maps tiles on Android

1. Open [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → enable **Maps SDK for Android** (and optionally Maps SDK for iOS)
3. Create an **API key** (restrict to your package `com.withyou.pair`)
4. Before building the APK:

```bat
set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=YOUR_KEY_HERE
```

Or put it in a local env for CI secrets.

5. Rebuild Android APK (prebuild must re-run so the key is injected).

With a key set, the app uses native **Google Maps** (`PROVIDER_GOOGLE`) on Android.
