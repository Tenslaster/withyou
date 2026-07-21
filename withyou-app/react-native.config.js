/**
 * Android maps strategy:
 * - Without GOOGLE_MAPS_API_KEY: do not link native Google Maps (avoids crashes).
 *   In-app map uses WebView + OpenStreetMap / Carto (professional dark tiles).
 * - With a key set at build time, re-enable linking by removing the android:null
 *   block or setting EXPO_PUBLIC_GOOGLE_MAPS_API_KEY before prebuild.
 */
const hasGoogleKey = Boolean(
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY
);

module.exports = {
  dependencies: {
    'react-native-maps': {
      platforms: hasGoogleKey
        ? {}
        : {
            // Disable native Google Maps on Android unless key provided
            android: null,
          },
    },
  },
};
