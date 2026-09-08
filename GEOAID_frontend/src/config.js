const API_PORT = import.meta.env.VITE_API_PORT || "8000";
const API_URL_OVERRIDE = (import.meta.env.VITE_API_URL || "").trim().replace(/\/$/, "");

function getApiUrl() {
  if (API_URL_OVERRIDE) return API_URL_OVERRIDE;

  if (import.meta.env.DEV) {
    return `http://${window.location.hostname}:${API_PORT}`;
  }

  // When deployed behind the same web origin, keep API requests same-origin.
  // Set VITE_API_URL when the frontend and backend are hosted separately.
  return window.location.origin;
}

export const API_URL = getApiUrl();

/**
 * Read a Django API response safely. If Django/Vite returns an HTML error page
 * instead of JSON, surface an actionable message instead of the raw
 * "Unexpected token <" JSON parsing error.
 */
export async function readApiResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  const body = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return JSON.parse(body || "{}");
    } catch {
      throw new Error("The backend returned invalid JSON. Restart the Django server and try again.");
    }
  }

  if (!response.ok || body.trim().startsWith("<!DOCTYPE") || body.trim().startsWith("<html")) {
    throw new Error(
      `The Django API did not return JSON (HTTP ${response.status}). ` +
      `Make sure the backend is running from GEOAID_backend on port ${API_PORT}.`
    );
  }

  throw new Error("The backend returned an unexpected response format.");
}
