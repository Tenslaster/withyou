/**
 * WithYou — disable react-native-maps on Android.
 * Google Maps native SDK is a common crash source without a Maps API key.
 * iOS keeps Apple Maps. Android uses a location card + external Maps intents.
 */
module.exports = {
  dependencies: {
    'react-native-maps': {
      platforms: {
        android: null,
      },
    },
  },
};
