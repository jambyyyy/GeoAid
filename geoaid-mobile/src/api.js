import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Public URL of the deployed Django backend. Used by the installed APK.
// Update this (and rebuild) whenever the tunnel / hosting URL changes.
const PRODUCTION_API_URL = 'https://runaround-bonelike-flavorful.ngrok-free.dev';

function getApiUrl() {
  const port = 8000; // must match Django's port (see manage.py runserver)

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

  return PRODUCTION_API_URL;
}

export const API_BASE = getApiUrl();
console.log('API_BASE is:', API_BASE); // remove once confirmed working