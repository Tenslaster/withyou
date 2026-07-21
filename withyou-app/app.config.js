/**
 * Expo config — supports optional Google Maps API key for native Android maps.
 *
 * Free OSM map works in-app without a key (WebView).
 * For true Google Maps tiles on Android, set:
 *   EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=your_key
 * or GOOGLE_MAPS_API_KEY=your_key
 * Enable "Maps SDK for Android" in Google Cloud Console.
 */
const googleMapsKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  process.env.GOOGLE_MAPS_API_KEY ||
  '';

module.exports = {
  expo: {
    name: 'WithYou',
    slug: 'withyou',
    version: '1.2.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    scheme: 'withyou',
    splash: {
      image: './assets/splash-icon.png',
      resizeMode: 'contain',
      backgroundColor: '#0f0a12',
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.withyou.pair',
      icon: './assets/icon.png',
      infoPlist: {
        ITSAppUsesNonExemptEncryption: false,
        NSLocationWhenInUseUsageDescription:
          'WithYou shares your location with your partner so you both know you\'re safe.',
        NSLocationAlwaysAndWhenInUseUsageDescription:
          'WithYou can update your location in the background for your partner only.',
        NSLocationAlwaysUsageDescription:
          'WithYou can update your location in the background for your partner only.',
        UIBackgroundModes: ['location', 'fetch', 'remote-notification'],
      },
      config: googleMapsKey
        ? {
            googleMapsApiKey: googleMapsKey,
          }
        : undefined,
    },
    android: {
      package: 'com.withyou.pair',
      versionCode: 10,
      adaptiveIcon: {
        backgroundColor: '#ffb6c1',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'ACCESS_BACKGROUND_LOCATION',
        'FOREGROUND_SERVICE',
        'FOREGROUND_SERVICE_LOCATION',
        'RECEIVE_BOOT_COMPLETED',
        'POST_NOTIFICATIONS',
        'INTERNET',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.ACCESS_BACKGROUND_LOCATION',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_LOCATION',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.INTERNET',
      ],
      config: googleMapsKey
        ? {
            googleMaps: {
              apiKey: googleMapsKey,
            },
          }
        : undefined,
    },
    plugins: [
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow WithYou to share your location with your partner.',
          isAndroidBackgroundLocationEnabled: true,
          isIosBackgroundLocationEnabled: true,
        },
      ],
      'expo-secure-store',
      'expo-localization',
      [
        'expo-notifications',
        {
          color: '#f472b6',
        },
      ],
      // Only inject Google Maps plugin when a key is present
      ...(googleMapsKey
        ? [
            [
              'react-native-maps',
              {
                androidGoogleMapsApiKey: googleMapsKey,
                iosGoogleMapsApiKey: googleMapsKey,
              },
            ],
          ]
        : []),
    ],
    extra: {
      apiUrl: 'https://crew.kingdom.forum/withyou',
      googleMapsApiKey: googleMapsKey || null,
      useNativeGoogleMaps: Boolean(googleMapsKey),
      eas: {
        projectId: '4cabcd56-61e9-49bf-8214-e2c37661dfca',
      },
    },
    owner: 'tenslaster',
  },
};
