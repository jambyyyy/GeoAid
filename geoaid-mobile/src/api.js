import Constants from 'expo-constants';
import { Platform } from 'react-native';

function getApiUrl() {
  const port = 8080;

  if (__DEV__) {
    if (Platform.OS === 'web') {
      // Use the browser's own hostname — works for localhost and LAN IP
      return `http://${window.location.hostname}:${port}`;
    }

    const hostUri =
      Constants.expoConfig?.hostUri ||
      Constants.expoGoConfig?.debuggerHost ||
      Constants.manifest2?.extra?.expoClient?.hostUri;

    const host = hostUri?.split(':')[0];

    if (host) {
      return `http://${host}:${port}`;
    }
  }

  return 'https://your-production-api.com';
}

export const API_BASE = getApiUrl();
console.log('API_BASE is:', API_BASE); // remove once confirmed working