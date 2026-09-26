import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { PinIcon, NavIconArrow } from "../components/icons";
import { API_BASE } from "../api";

// Evacuation centers on a map, for residents.
//
// Uses Leaflet + OpenStreetMap tiles inside a WebView instead of
// react-native-maps, so it needs no Google Maps API key or billing
// account — the same approach as the DRRM web dashboard's map.
//
// Data comes straight from the DRRM map endpoint (same one the DRRM
// dashboard uses); this screen only reads it and only shows the
// evacuation-center pins — no risk circles, no route pinning.
//
//   GET /api/drrm/map/  -> { centers: [{ id, name, barangay, latitude,
//                             longitude, capacity, occupancy, status,
//                             eligible, ineligible_reason, approximate }] }
//
// Navigation param (optional): route.params.focusCenterId — if the resident
// arrived here via "Get Directions" on a specific center, that pin opens
// selected and the map centers on it.
//
// Live location: tapping the location button starts watchPositionAsync,
// which keeps posting fixes into the WebView (window.__evacMap.setUserLocation)
// as the resident moves, rather than taking one reading. Tap again to stop.

const DEFAULT_CENTER = { latitude: 8.2286, longitude: 124.2381 }; // Iligan City

const escapeJs = (value) => JSON.stringify(String(value ?? ""));

function buildMapHtml() {
  // The page itself carries no data — centers/focus/user-location are sent
  // in afterward via injectJavaScript once the WebView reports it's ready,
  // so re-fetches or a location fix don't require reloading the page.
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { height: 100%; margin: 0; padding: 0; }
    .evac-pin { display:block; filter: drop-shadow(0 2px 2px rgba(0,0,0,.35)); }
    .user-dot { width:16px; height:16px; border-radius:50%; background:#2563eb; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4); }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map("map", { zoomControl: false }).setView([${DEFAULT_CENTER.latitude}, ${DEFAULT_CENTER.longitude}], 12);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const pinSvg = (color) =>
      '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 24 32" class="evac-pin">' +
      '<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="' + color + '" stroke="#fff" stroke-width="1.5"/>' +
      '<circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>';

    const centerIcon = (status) => L.divIcon({
      className: "",
      html: pinSvg(status === "open" ? "#16a34a" : "#dc2626"),
      iconSize: [30, 40],
      iconAnchor: [15, 40],
    });
    const userIcon = L.divIcon({ className: "", html: '<div class="user-dot"></div>', iconSize: [16, 16], iconAnchor: [8, 8] });

    let markers = [];
    let userMarker = null;
    let routeLine = null;
    let routeStartMarker = null;

    function setCenters(centers) {
      markers.forEach((m) => map.removeLayer(m));
      markers = centers.map((c) => {
        const marker = L.marker([c.latitude, c.longitude], { icon: centerIcon(c.status) }).addTo(map);
        marker.on("click", () => {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "select", id: c.id }));
        });
        return marker;
      });
      if (centers.length) {
        map.fitBounds(L.latLngBounds(centers.map((c) => [c.latitude, c.longitude])), { padding: [50, 50], maxZoom: 15 });
      }
    }

    function focusOn(lat, lng) {
      map.setView([lat, lng], 16, { animate: true });
    }

    function setUserLocation(lat, lng) {
      if (userMarker) {
        // Move the existing dot instead of re-adding it, so live updates
        // don't flicker.
        userMarker.setLatLng([lat, lng]);
      } else {
        userMarker = L.marker([lat, lng], { icon: userIcon, zIndexOffset: 1000 }).addTo(map);
      }
    }

    function clearUserLocation() {
      if (userMarker) { map.removeLayer(userMarker); userMarker = null; }
    }

    // OSRM's free public demo routers — same OpenStreetMap data as the
    // map tiles, no API key. They only snap points to real roads/paths
    // and return the geometry to follow between them; they don't know
    // about DRRM's pinned routes, flooded roads, or risk levels —
    // Dijkstra (routing.py, server-side) already decided *which*
    // barangays/roads to go through, this only draws that decision as a
    // real path instead of a straight line. Note for production: these
    // are shared, rate-limited demo servers (~1 req/sec, no uptime
    // guarantee) — fine for dev/thesis use, but self-host an OSRM
    // instance before scaling up.
    // Two hosts, tried in order: the -foot instance walks real footpaths;
    // if it's unreachable (network hiccup, rate limit, DNS), the well-known
    // main demo server is tried next so a route still snaps to roads
    // (using its driving profile) instead of falling all the way back to
    // a straight line.
    const OSRM_HOSTS = [
      { url: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/", label: "osrm-foot" },
      { url: "https://router.project-osrm.org/route/v1/driving/", label: "osrm-driving" },
    ];

    async function fetchRoadRoute(waypoints) {
      // OSRM wants "lng,lat;lng,lat;...", our waypoints are [lat, lng].
      const coordsParam = waypoints.map((p) => p[1] + "," + p[0]).join(";");
      let lastErr = null;
      for (const host of OSRM_HOSTS) {
        try {
          const url = host.url + coordsParam + "?overview=full&geometries=geojson";
          const res = await fetch(url);
          if (!res.ok) throw new Error(host.label + " HTTP " + res.status);
          const data = await res.json();
          const route = data.routes && data.routes[0];
          if (data.code !== "Ok" || !route) throw new Error(host.label + " code=" + data.code);
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: "route_debug", ok: true, host: host.label }));
          // GeoJSON coordinates are [lng, lat] — flip back for Leaflet.
          return route.geometry.coordinates.map((c) => [c[1], c[0]]);
        } catch (err) {
          lastErr = err;
        }
      }
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: "route_debug", ok: false, error: String(lastErr) }));
      throw lastErr || new Error("no OSRM host reachable");
    }

    // Draws the Dijkstra route returned by /api/resident/evacuation/
    // nearest-route/ entirely inside this map — this is what replaces
    // handing the resident off to the Google Maps app. coords is
    // [[lat, lng], ...], the barangay-by-barangay waypoints Dijkstra
    // chose (routing.py's rebuilt path geometry); this function snaps
    // that to the actual road/path network before drawing it.
    async function setRoute(coords) {
      clearRoute();
      if (!coords || coords.length < 2) return;

      const startPt = coords[0];
      routeStartMarker = L.circleMarker(startPt, {
        radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1,
      }).addTo(map);

      // Bright dashed placeholder so it's obviously "not a real road yet"
      // rather than looking like a finished route — replaced below once
      // the road-snapped geometry comes back.
      routeLine = L.polyline(coords, { color: "#f97316", weight: 3, opacity: 0.8, dashArray: "2 10" }).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [60, 60], maxZoom: 16 });

      try {
        const roadCoords = await fetchRoadRoute(coords);
        if (roadCoords.length > 1) {
          map.removeLayer(routeLine);
          routeLine = L.polyline(roadCoords, { color: "#2563eb", weight: 5, opacity: 0.85 }).addTo(map);
          map.fitBounds(routeLine.getBounds(), { padding: [60, 60], maxZoom: 16 });
        }
      } catch (err) {
        // Offline, both routers unreachable, or a waypoint neither could
        // snap to a road — keep the dashed straight-line placeholder
        // rather than show nothing. (See the "route_debug" message this
        // already sent back to React Native for the actual reason.)
      }
    }

    function clearRoute() {
      if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
      if (routeStartMarker) { map.removeLayer(routeStartMarker); routeStartMarker = null; }
    }

    // Bridge from React Native: window.__evacMap.<fn>(...)
    window.__evacMap = { setCenters, focusOn, setUserLocation, clearUserLocation, setRoute, clearRoute };
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: "ready" }));
  </script>
</body>
</html>`;
}

const MAP_HTML = buildMapHtml();

function EvacuationMapScreen({ navigation, route }) {
  const webviewRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const [centers, setCenters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [locating, setLocating] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [locError, setLocError] = useState("");
  const [routing, setRouting] = useState(false);
  const [routeInfo, setRouteInfo] = useState(null); // { distance_km, est_minutes, center_name }
  const [routeError, setRouteError] = useState("");
  const watchSubRef = useRef(null);
  const lastFixRef = useRef(null); // most recent {latitude, longitude} we have, if any

  const focusCenterId = route?.params?.focusCenterId;
  const selected = useMemo(() => centers.find((c) => String(c.id) === String(selectedId)) || null, [centers, selectedId]);

  const runInMap = (js) => webviewRef.current?.injectJavaScript(`${js} true;`);

  // ---- load evacuation centers -------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_BASE}/api/drrm/map/`);
        if (!response.ok) throw new Error(`Request failed (${response.status})`);
        const data = await response.json();
        if (cancelled) return;
        setCenters(data.centers || []);
        setError("");
      } catch (err) {
        console.warn("Failed to load evacuation centers:", err.message);
        if (!cancelled) setError("Unable to load evacuation centers. Pull down to retry.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- push centers into the map once both are ready ----------------------
  useEffect(() => {
    if (!mapReady) return;
    runInMap(`window.__evacMap.setCenters(${JSON.stringify(centers)});`);
    if (focusCenterId) {
      const target = centers.find((c) => String(c.id) === String(focusCenterId));
      if (target) {
        setSelectedId(target.id);
        runInMap(`window.__evacMap.focusOn(${target.latitude}, ${target.longitude});`);
      }
    }
  }, [mapReady, centers]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleWebViewMessage = (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === "ready") setMapReady(true);
      if (msg.type === "select") {
        setSelectedId(msg.id);
        // Picking a different center invalidates whatever route was drawn
        // for the previous one.
        setRouteInfo(null);
        setRouteError("");
        runInMap("window.__evacMap.clearRoute();");
      }
      if (msg.type === "route_debug") {
        // Comes from setRoute()'s attempt to snap the Dijkstra path onto
        // real roads via OSRM (see buildMapHtml). Logged here so a failure
        // (offline, both OSRM hosts unreachable, rate limited, etc.) is
        // visible instead of just silently falling back to the dashed
        // straight-line placeholder on the map.
        if (msg.ok) {
          console.log("Route snapped to roads via", msg.host);
        } else {
          console.warn("Could not snap route to roads, showing straight line:", msg.error);
        }
      }
    } catch (err) {
      console.warn("Bad message from map:", err.message);
    }
  };

  // ---- live location ------------------------------------------------------
  useEffect(() => {
    // Stop watching if the screen unmounts while tracking is on, so it
    // doesn't keep the GPS running in the background.
    return () => {
      watchSubRef.current?.remove();
      watchSubRef.current = null;
    };
  }, []);

  const startTracking = async () => {
    setLocError("");

    // The WebView's page (and window.__evacMap) may not have finished
    // loading yet — sending it a command before then fails silently inside
    // the WebView with no error surfaced to React Native, which is why the
    // dot could appear to just do nothing.
    if (!mapReady) {
      setLocError("Map is still loading — try again in a moment.");
      return;
    }

    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setLocError("Location permission was denied. Enable it in your phone's Settings to use this.");
        return;
      }

      // One immediate fix so the dot appears right away and the map can
      // centre on it, then keep watching for updates as the resident moves.
      const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      lastFixRef.current = { latitude: first.coords.latitude, longitude: first.coords.longitude };
      runInMap(`window.__evacMap.setUserLocation(${first.coords.latitude}, ${first.coords.longitude});`);
      runInMap(`window.__evacMap.focusOn(${first.coords.latitude}, ${first.coords.longitude});`);

      watchSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, distanceInterval: 10, timeInterval: 4000 },
        (pos) => {
          const { latitude, longitude } = pos.coords;
          lastFixRef.current = { latitude, longitude };
          runInMap(`window.__evacMap.setUserLocation(${latitude}, ${longitude});`);
        }
      );
      setTracking(true);
    } catch (err) {
      console.warn("Could not start location tracking:", err.message);
      setLocError("Could not get your location. Make sure Location Services are turned on.");
    } finally {
      setLocating(false);
    }
  };

  const stopTracking = () => {
    watchSubRef.current?.remove();
    watchSubRef.current = null;
    setTracking(false);
    runInMap("window.__evacMap.clearUserLocation();");
  };

  const toggleTracking = () => {
    if (tracking) stopTracking();
    else startTracking();
  };

  // Draws the shortest (Dijkstra) path to this center right on our own
  // Leaflet map — the resident never leaves the app / gets handed off to
  // Google Maps. Uses the freshest GPS fix we have (from "show my
  // location" above) when there is one; otherwise the backend falls back
  // to the resident's saved household location.
  const getDirections = async (center) => {
    if (!mapReady) return;
    setRouting(true);
    setRouteError("");
    try {
      const mobileNumber = (await AsyncStorage.getItem("geoaid_resident_mobile")) || "";
      const params = new URLSearchParams({ mobile_number: mobileNumber, center_id: String(center.id) });
      const fix = lastFixRef.current;
      if (fix) {
        params.set("lat", String(fix.latitude));
        params.set("lng", String(fix.longitude));
      }

      const response = await fetch(`${API_BASE}/api/resident/evacuation/nearest-route/?${params.toString()}`);
      const json = await response.json();

      if (!response.ok || !json.recommended) {
        setRouteError(json.message || "Couldn't find a route to this center yet.");
        runInMap("window.__evacMap.clearRoute();");
        setRouteInfo(null);
        return;
      }

      const { geometry, distance_km, est_minutes } = json.recommended;
      runInMap(`window.__evacMap.setRoute(${JSON.stringify(geometry)});`);
      setRouteInfo({ centerName: center.name, distance_km, est_minutes });
    } catch (err) {
      console.warn("Could not fetch evacuation route:", err.message);
      setRouteError("Couldn't reach the server to plot a route. Check your connection.");
      runInMap("window.__evacMap.clearRoute();");
      setRouteInfo(null);
    } finally {
      setRouting(false);
    }
  };

  const closeDetail = () => {
    setSelectedId(null);
    setRouteInfo(null);
    setRouteError("");
    runInMap("window.__evacMap.clearRoute();");
  };

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Back">
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Evacuation Centers</Text>
          <TouchableOpacity
            onPress={toggleTracking}
            style={styles.backBtn}
            accessibilityLabel={tracking ? "Stop sharing my location" : "Show my live location"}
            disabled={locating}
          >
            {locating ? (
              <ActivityIndicator size="small" color="#2563eb" />
            ) : (
              <PinIcon color={tracking ? "#16a34a" : "#2563eb"} />
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.mapWrap}>
          <WebView
            ref={webviewRef}
            originWhitelist={["*"]}
            source={{ html: MAP_HTML }}
            onMessage={handleWebViewMessage}
            style={styles.map}
          />
          {loading || !mapReady ? (
            <View style={styles.mapOverlay}>
              <ActivityIndicator size="large" color="#2563eb" />
              <Text style={styles.loadingText}>Loading evacuation centers…</Text>
            </View>
          ) : null}

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          ) : null}

          {locError ? (
            <TouchableOpacity style={styles.errorBanner} onPress={() => setLocError("")}>
              <Text style={styles.errorBannerText}>{locError} (tap to dismiss)</Text>
            </TouchableOpacity>
          ) : null}

          {routeError ? (
            <TouchableOpacity style={styles.errorBanner} onPress={() => setRouteError("")}>
              <Text style={styles.errorBannerText}>{routeError} (tap to dismiss)</Text>
            </TouchableOpacity>
          ) : null}

          {routeInfo ? (
            <View style={styles.routeBadge}>
              <NavIconArrow />
              <Text style={styles.routeBadgeText}>
                {routeInfo.distance_km} km · ~{routeInfo.est_minutes} min to {routeInfo.centerName}
              </Text>
            </View>
          ) : null}

          {selected ? (
            <View style={styles.detailCard}>
              <TouchableOpacity style={styles.detailClose} onPress={closeDetail} accessibilityLabel="Close">
                <Text style={styles.detailCloseText}>×</Text>
              </TouchableOpacity>

              <Text style={styles.detailName}>{selected.name}</Text>
              <Text style={styles.detailMeta}>{selected.barangay}</Text>

              <View style={styles.detailRow}>
                <View
                  style={[
                    styles.statusPill,
                    { backgroundColor: selected.status === "open" ? "#dcfce7" : "#fee2e2" },
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      { color: selected.status === "open" ? "#15803d" : "#991b1b" },
                    ]}
                  >
                    {selected.status === "open" ? "OPEN" : "CLOSED"}
                  </Text>
                </View>
                {selected.capacity ? (
                  <Text style={styles.detailMeta}>
                    {selected.occupancy}/{selected.capacity} occupied
                  </Text>
                ) : null}
              </View>

              {!selected.eligible && selected.ineligible_reason ? (
                <Text style={styles.detailWarning}>{selected.ineligible_reason}</Text>
              ) : null}
              {selected.approximate ? (
                <Text style={styles.detailNote}>Location is approximate (barangay center).</Text>
              ) : null}

              <TouchableOpacity
                style={[styles.directionsBtn, routing && styles.directionsBtnDisabled]}
                onPress={() => getDirections(selected)}
                disabled={routing}
              >
                {routing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <PinIcon color="#fff" />
                    <Text style={styles.directionsBtnText}>Get Directions</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : !loading && mapReady && centers.length === 0 && !error ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyCardText}>No evacuation centers have been registered yet.</Text>
            </View>
          ) : null}
        </View>
      </View>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  backBtnText: { fontSize: 26, color: "#0f172a", marginTop: -2 },
  headerTitle: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  mapWrap: { flex: 1 },
  map: { flex: 1, backgroundColor: "#eef0f3" },
  mapOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#f8fafc",
  },
  loadingText: { fontSize: 13, color: "#64748b" },
  errorBanner: {
    position: "absolute",
    top: 12,
    left: 16,
    right: 16,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 10,
    padding: 10,
  },
  errorBannerText: { color: "#9a3412", fontSize: 12 },
  routeBadge: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    zIndex: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#2563eb",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  routeBadgeText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  detailCard: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  detailClose: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCloseText: { fontSize: 20, color: "#94a3b8" },
  detailName: { fontSize: 16, fontWeight: "700", color: "#0f172a", paddingRight: 24 },
  detailMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  statusPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  detailWarning: { fontSize: 12, color: "#9a3412", marginTop: 8 },
  detailNote: { fontSize: 12, color: "#94a3b8", marginTop: 6, fontStyle: "italic" },
  directionsBtn: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  directionsBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  directionsBtnDisabled: { opacity: 0.7 },
  emptyCard: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
  },
  emptyCardText: { fontSize: 13, color: "#64748b", textAlign: "center" },
});

export default EvacuationMapScreen;