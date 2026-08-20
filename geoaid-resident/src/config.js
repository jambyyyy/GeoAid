function getApiUrl() {
  const port = 8000; // change this the day your Django port changes — nowhere else

  if (import.meta.env.DEV) {
    // Use whatever hostname the browser is actually loaded from —
    // works for localhost, 127.0.0.1, or your LAN IP automatically
    return `http://${window.location.hostname}:${port}`;
  }

  return "https://your-production-api.com"; // update when you deploy
}

export const API_URL = getApiUrl();
