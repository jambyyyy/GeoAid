import { API_URL } from "../../config";

// Finance endpoints need a server-issued token (obtained by re-entering the
// CSWD password). It lives only in sessionStorage and is cleared on logout.
const KEY = "geoaid_finance_token";

export const getFinanceToken = () => {
  try { return sessionStorage.getItem(KEY) || ""; } catch { return ""; }
};
export const setFinanceToken = (t) => {
  try { sessionStorage.setItem(KEY, t); } catch { /* ignore */ }
};
export const clearFinanceToken = () => {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
};

export class FinanceAuthRequired extends Error {}

// fetch() with the bearer token. `json` sends a JSON body; `body` (FormData)
// is sent as-is so the browser sets the multipart boundary itself.
export async function financeFetch(path, { method = "GET", json, body } = {}) {
  const headers = { Authorization: `Bearer ${getFinanceToken()}` };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : body,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    if (response.status === 401) clearFinanceToken();
    if (data.auth_required || response.status === 401) throw new FinanceAuthRequired(data.message || "");
  }
  return { ok: response.ok && data.success !== false, status: response.status, data };
}

export async function unlockFinance(username, password) {
  const response = await fetch(`${API_URL}/api/cswd/finance/unlock/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (response.ok && data.token) {
    setFinanceToken(data.token);
    return { ok: true };
  }
  return { ok: false, message: data.message || "Could not confirm your password." };
}

// One id per form submission attempt: a retry of the same submission carries
// the same id, so the server can never record it twice.
export function newRequestId() {
  const c = typeof crypto !== "undefined" ? crypto : null;
  if (c && c.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && c.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---- money display helpers (display only; the server recomputes everything) ----
// Work in integer centavos so 0.1 + 0.2 style float errors cannot appear.
export const toCents = (text) => {
  const t = String(text ?? "").trim().replace(/,/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
};
export const formatPeso = (value) => {
  // value: server string like "2140.00" OR integer centavos when `cents` is passed
  const n = Number(value);
  return `₱${(Number.isFinite(n) ? n : 0).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
export const formatCents = (cents) => formatPeso((cents || 0) / 100);
