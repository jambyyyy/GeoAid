// Relief-goods notifications for the resident app.
//
// No backend / model changes: this reads the existing
// GET /api/resident/relief-distribution/ endpoint and remembers, on the
// phone (AsyncStorage), which relief updates the resident has already
// been told about. An update is "new" when a household-level release
// appears (Processing) or moves to Ready for Pickup.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE } from "./api";

export const MOBILE_KEY = "geoaid_resident_mobile";
export const RELIEF_POLL_MS = 30000;

const SEEN_PREFIX = "geoaid_relief_seen_v1:";

// "pending" is a legacy status that the app already treats as processing.
const stageOf = (status) => (status === "pending" ? "processing" : status);

const readSeen = async (mobile) => {
  try {
    const raw = await AsyncStorage.getItem(SEEN_PREFIX + mobile);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const goodsLabel = (r) =>
  `${r.goods_type || "Relief goods"}${r.quantity ? ` ×${r.quantity}` : ""}`;

function buildAlert(r) {
  const stage = stageOf(r.status);
  const goods = goodsLabel(r);
  const tracking = r.tracking_number ? ` (Tracking ${r.tracking_number})` : "";

  return stage === "ready"
    ? {
        id: r.id,
        stage,
        title: "Relief goods ready for pickup",
        message: `${goods} is ready. Collect it from your Barangay staff${tracking}.`,
      }
    : {
        id: r.id,
        stage,
        title: "Relief goods are on the way",
        message: `${goods} is being prepared for your household${tracking}.`,
      };
}

// Fetches the household's relief data and returns the headline status
// plus the alerts the resident has not seen yet (ready ones first).
export async function loadReliefAlerts() {
  const mobile = (await AsyncStorage.getItem(MOBILE_KEY)) || "";
  if (!mobile) return { status: null, alerts: [] };

  const response = await fetch(
    `${API_BASE}/api/resident/relief-distribution/?mobile_number=${encodeURIComponent(mobile)}`,
  );
  if (!response.ok) throw new Error("Relief status unavailable");

  const json = await response.json();
  const seen = await readSeen(mobile);

  const alerts = (json.distribution_history || [])
    // Only the household's own releases; barangay-level batches are not
    // shown to residents. Received/cancelled ones need no alert.
    .filter(
      (r) =>
        r.scope === "household" &&
        ["processing", "pending", "ready"].includes(r.status),
    )
    .filter((r) => seen[r.id] !== stageOf(r.status))
    .map(buildAlert)
    .sort(
      (a, b) => (a.stage === "ready" ? -1 : 0) - (b.stage === "ready" ? -1 : 0),
    );

  return { status: json.status || null, alerts };
}

// Marks releases as seen so they are not announced again. Accepts alerts
// ({id, stage}) or raw history records ({id, status}).
export async function markReliefSeen(items) {
  try {
    const mobile = (await AsyncStorage.getItem(MOBILE_KEY)) || "";
    if (!mobile || !items || !items.length) return;

    const seen = await readSeen(mobile);
    items.forEach((r) => {
      seen[r.id] = r.stage || stageOf(r.status);
    });
    await AsyncStorage.setItem(SEEN_PREFIX + mobile, JSON.stringify(seen));
  } catch {
    // Notifications are best-effort; never break the screen.
  }
}
