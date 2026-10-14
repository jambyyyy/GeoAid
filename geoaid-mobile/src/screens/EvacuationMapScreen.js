import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import * as Location from "expo-location";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { PinIcon, NavIconArrow } from "../components/icons";
import { UI } from "../residentPolish";
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
    .user-dot { width:17px; height:17px; border-radius:50%; background:#2563eb; border:3px solid #fff; box-shadow:0 1px 4px rgba(0,0,0,.4); flex:0 0 17px; }
    .user-location-label { display:flex; align-items:center; gap:7px; width:max-content;
      padding:6px 10px; border:1.5px solid #bfdbfe; background:#fff; color:#1d4ed8;
      border-radius:22px; box-shadow:0 3px 10px rgba(15,23,42,.17);
      font:700 12px system-ui,-apple-system,sans-serif; white-space:nowrap; }
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
    const userIcon = L.divIcon({ className: "", html:
      '<div class="user-location-label"><span class="user-dot"></span>My Current Location</div>',
      iconSize: [167, 34], iconAnchor: [12, 17] });

    let markers = [];
    let userMarker = null;
    let routeLine = null;
    let routeStartMarker = null;
    let routeRequestSequence = 0;

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

    // GeoAid/Django still selects the evacuation center using the unchanged
    // DRRM risk-weighted Dijkstra graph. The street-route service below only
    // draws road geometry to that selected center; it does not choose it.
    // IMPORTANT: driving roads, pedestrian paths, and DRRM graph waypoints
    // are different things and must never be silently substituted for one another.
    const STREET_ROUTERS = {
      // A foot route can favor coastal shortcuts and walkways instead of
      // the main road; use driving mode explicitly for the main-road view.
      road: { url: "https://router.project-osrm.org/route/v1/driving/", profile: "driving" },
      walk: { url: "https://routing.openstreetmap.de/routed-foot/route/v1/foot/", profile: "walking" },
    };

    async function fetchStreetRoute(endpoints, mode) {
      const router = STREET_ROUTERS[mode];
      if (!router) throw new Error("Unsupported routing mode");
      const coordinates = endpoints.map((p) => p[1] + "," + p[0]).join(";");
      const url = router.url + coordinates + "?overview=full&geometries=geojson&steps=false";
      const res = await fetch(url);
      if (!res.ok) throw new Error(router.profile + " road server returned " + res.status);
      const json = await res.json();
      const route = json.routes && json.routes[0];
      if (json.code !== "Ok" || !route || !route.geometry ||
          !Array.isArray(route.geometry.coordinates) || route.geometry.coordinates.length < 2) {
        throw new Error("No " + router.profile + " route on mapped streets");
      }
      const snaps = (json.waypoints || []).map((w) => Number(w.distance) || 0);
      return {
        snapsM: snaps,
        coords: route.geometry.coordinates.map((c) => [c[1], c[0]]),
        distanceKm: Math.round(route.distance / 10) / 100,
        durationMin: Math.max(1, Math.round(route.duration / 60)),
        profile: router.profile,
      };
    }

    async function setRoute(coords, mode) {
      clearRoute();
      const requestId = routeRequestSequence;
      const allPoints = (Array.isArray(coords) ? coords : []).filter((p) =>
        Array.isArray(p) && p.length === 2 &&
        Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])));
      if (allPoints.length < 2) return;
      routeStartMarker = L.circleMarker(allPoints[0], {
        radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1,
      }).addTo(map);

      if (mode === "risk") {
        // DRRM option: the DESTINATION was chosen by the DRRM risk-weighted
        // Dijkstra on the server. Directions are real mapped-road geometry
        // (driving) from the start to that destination, passing through the
        // DRRM graph waypoints only when each waypoint sits on/near a mapped
        // road. Straight lines between waypoints are NEVER drawn.
        const MAX_SNAP_M = 300;
        try {
          let street = null;
          let viaUsed = false;
          if (allPoints.length > 2) {
            try {
              const viaTry = await fetchStreetRoute(allPoints, "road");
              const inner = viaTry.snapsM.slice(1, -1);
              if (inner.every((d) => d <= MAX_SNAP_M)) { street = viaTry; viaUsed = true; }
            } catch (e) { /* fall back to start -> destination below */ }
          }
          if (!street) street = await fetchStreetRoute([allPoints[0], allPoints[allPoints.length - 1]], "road");
          if (requestId !== routeRequestSequence) return;
          routeLine = L.polyline(street.coords, { color: "#f97316", weight: 5, opacity: 0.95 }).addTo(map);
          map.fitBounds(routeLine.getBounds(), { padding: [38, 38], maxZoom: 16 });
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "route_debug", ok: true, mode: "risk",
            distanceKm: street.distanceKm, durationMin: street.durationMin,
            profile: street.profile, viaWaypoints: viaUsed,
          }));
        } catch (err) {
          if (requestId !== routeRequestSequence) return;
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: "route_debug", ok: false, mode: "risk", error: String(err),
          }));
        }
        return;
      }

      // Use ONLY actual start and destination for street routing, not the
      // intermediate barangay centroids from the DRRM graph. The old map
      // used a walking route first, which explains detours off main roads.
      const endpoints = [allPoints[0], allPoints[allPoints.length - 1]];
      try {
        const street = await fetchStreetRoute(endpoints, mode);
        if (requestId !== routeRequestSequence) return;
        routeLine = L.polyline(street.coords, {
          color: mode === "walk" ? "#0d9488" : "#2563eb",
          weight: 5, opacity: 0.95,
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [38, 38], maxZoom: 16 });
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "route_debug", ok: true, mode,
          distanceKm: street.distanceKm,
          durationMin: street.durationMin,
          profile: street.profile,
        }));
      } catch (err) {
        if (requestId !== routeRequestSequence) return;
        // On failure don't draw a fake straight line or secretly fall back
        // to a different travel mode. Explain the unavailable route.
        window.ReactNativeWebView.postMessage(JSON.stringify({
          type: "route_debug", ok: false, mode, error: String(err),
        }));
      }
    }

    function clearRoute() {
      routeRequestSequence++;
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
  const [routeRoadStatus, setRouteRoadStatus] = useState("idle");
  const [routeMode, setRouteMode] = useState("road");
  const [roadSummary, setRoadSummary] = useState(null);
  const routePointsRef = useRef(null);
  const watchSubRef = useRef(null);
  const lastFixRef = useRef(null); // most recent {latitude, longitude} we have, if any
  const checkedExistingLocationRef = useRef(false);
  const [locationAvailable, setLocationAvailable] = useState(false);

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
        setRouteRoadStatus("idle");
        setRoadSummary(null);
        routePointsRef.current = null;
        runInMap("window.__evacMap.clearRoute();");
      }
      if (msg.type === "route_debug") {
        if (msg.ok) {
          setRouteRoadStatus("road_guide");
          setRouteMode(msg.mode);
          setRoadSummary({
            distanceKm: msg.distanceKm,
            durationMin: msg.durationMin,
            profile: msg.profile,
            viaWaypoints: msg.viaWaypoints === true,
          });
        } else {
          setRouteRoadStatus("unavailable");
          setRoadSummary(null);
          // Stay on the selected tab; don't pretend a failed street request
          // returned the DRRM graph or a valid route.
          console.warn("Street route unavailable:", msg.error);
        }
      }
    } catch (err) {
      console.warn("Bad message from map:", err.message);
    }
  };

  // Show a saved permission's location as soon as the map is ready. Never
  // silently request new GPS permission: the visible button does that.
  useEffect(() => {
    if (!mapReady || checkedExistingLocationRef.current) return;
    checkedExistingLocationRef.current = true;
    let disposed = false;
    (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== "granted") return;
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (disposed) return;
        const { latitude, longitude } = fix.coords;
        lastFixRef.current = { latitude, longitude };
        setLocationAvailable(true);
        runInMap(`window.__evacMap.setUserLocation(${latitude}, ${longitude});`);
        if (!focusCenterId) runInMap(`window.__evacMap.focusOn(${latitude}, ${longitude});`);
      } catch (err) {
        console.warn("Existing location unavailable:", err.message);
      }
    })();
    return () => { disposed = true; };
  }, [mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const centerOnMyLocation = () => {
    const fix = lastFixRef.current;
    if (!fix) return;
    runInMap(`window.__evacMap.focusOn(${fix.latitude}, ${fix.longitude});`);
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
      setLocationAvailable(true);

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
    // Stopping continuous GPS updates does not erase the latest verified
    // location; residents can still return to that point on the map.
    if (lastFixRef.current) setLocationAvailable(true);
  };

  const toggleTracking = () => {
    if (tracking) stopTracking();
    else startTracking();
  };

  // Routing decisions remain entirely server-side in existing Dijkstra API.
  // center === null: let backend choose the lowest-cost eligible center.
  // center provided: get the best recorded route specifically to that center.
  const getDirections = async (center = null) => {
    if (!mapReady || routing) return;
    setRouting(true);
    setRouteError("");
    setRouteRoadStatus("loading");
    setRoadSummary(null);
    try {
      const mobileNumber = (await AsyncStorage.getItem("geoaid_resident_mobile")) || "";
      const params = new URLSearchParams({ mobile_number: mobileNumber });
      if (center?.id) params.set("center_id", String(center.id));
      const fix = lastFixRef.current;
      if (fix) {
        params.set("lat", String(fix.latitude));
        params.set("lng", String(fix.longitude));
      }
      // Backend defaults to avoid_risk=1 and returns the risk-weighted
      // Dijkstra result; do not change any route-cost calculations here.
      const response = await fetch(`${API_BASE}/api/resident/evacuation/nearest-route/?${params.toString()}`);
      const json = await response.json();
      const result = json.recommended;
      if (!response.ok || !result?.eligible || !Array.isArray(result.geometry) || result.geometry.length < 2) {
        setRouteError(json.message || "No eligible evacuation route is available right now. Check with Barangay or DRRM staff.");
        runInMap("window.__evacMap.clearRoute();");
        setRouteInfo(null);
        return;
      }
      // Never imply a point is live GPS when the API used a saved position
      // or barangay centroid instead.
      const src = json.start?.source || "unknown";
      if (src !== "live_gps") setLocError("");
      setSelectedId(result.center.id);
      // The backend still chooses the eligible center with Dijkstra.
      // Initially show vehicular main roads to the selected center. Residents
      // can compare walking paths or the unchanged DRRM graph at any time.
      routePointsRef.current = result.geometry;
      setRouteMode("road");
      runInMap(`window.__evacMap.setRoute(${JSON.stringify(result.geometry)}, "road");`);
      setRouteInfo({
        centerName: result.center.name,
        distance_km: result.distance_km,
        est_minutes: result.est_minutes,
        locationSource: src,
        riskAware: json.avoid_risk === true,
        isRecommended: center == null,
        legs: result.legs || [],
      });
    } catch (err) {
      console.warn("Could not fetch evacuation route:", err.message);
      setRouteError("Could not calculate the route. Check your connection and try again.");
      runInMap("window.__evacMap.clearRoute();");
      setRouteInfo(null);
    } finally {
      setRouting(false);
    }
  };

  const chooseRouteView = (mode) => {
    if (!routePointsRef.current || routeMode === mode) return;
    setRoadSummary(null);
    setRouteRoadStatus("loading");
    setRouteMode(mode);
    runInMap(`window.__evacMap.setRoute(${JSON.stringify(routePointsRef.current)}, ${JSON.stringify(mode)});`);
  };

  const closeDetail = () => {
    setSelectedId(null);
    setRouteInfo(null);
    setRouteError("");
    setRouteRoadStatus("idle");
    setRoadSummary(null);
    routePointsRef.current = null;
    runInMap("window.__evacMap.clearRoute();");
  };

  return (
    <MobileShell>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityLabel="Back">
            <Text style={styles.backBtnText}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Evacuation Map</Text>
          <View style={styles.headerSpacer} />
        </View>
        <View style={styles.mapLegend}>
          <Text style={styles.legendText}><Text style={styles.legendOpen}>●</Text> Open center</Text>
          <Text style={styles.legendText}><Text style={styles.legendClosed}>●</Text> Closed center</Text>
        </View>
        <View style={styles.routeActionRow}>
          <TouchableOpacity
            style={[styles.recommendedBtn, (routing || !mapReady) && styles.directionsBtnDisabled]}
            onPress={() => getDirections()}
            disabled={routing || !mapReady}
            accessibilityRole="button"
            accessibilityLabel="Find GeoAid recommended evacuation route"
          >
            {routing ? <ActivityIndicator color="#fff" size="small" /> : <NavIconArrow color="#fff" />}
            <Text style={styles.recommendedBtnText}>Find Recommended Route</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.mapInstruction}>
          <Text style={styles.mapInstructionText}>GeoAid selects an evacuation center using DRRM records. Road directions are separate estimates; always follow official hazard and evacuation advisories.</Text>
        </View>

        {routeInfo ? (
          <View style={styles.routeBadge}>
            <Text style={styles.routeBadgeTitle} numberOfLines={1}>
              {routeInfo.centerName}
            </Text>
            <View style={styles.routeModeRow}>
              <TouchableOpacity
                onPress={() => chooseRouteView("road")}
                style={[styles.routeModeButton, routeMode === "road" && styles.routeModeActive]}
                accessibilityRole="button"
                accessibilityLabel="Main roads: driving route from a street map; road hazards are not verified"
              >
                <Text style={[styles.routeModeText, routeMode === "road" && styles.routeModeTextActive]}>Main roads</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => chooseRouteView("walk")}
                style={[styles.routeModeButton, routeMode === "walk" && styles.routeModeActive]}
                accessibilityRole="button"
                accessibilityLabel="Walking: pedestrian street and footpath route"
              >
                <Text style={[styles.routeModeText, routeMode === "walk" && styles.routeModeTextActive]}>Walking</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => chooseRouteView("risk")}
                style={[styles.routeModeButton, routeMode === "risk" && styles.routeModeActive]}
                accessibilityRole="button"
                accessibilityLabel="DRRM: street directions to the DRRM-selected center; not verified for floods or closures"
              >
                <Text style={[styles.routeModeText, routeMode === "risk" && styles.routeModeTextActive]}>DRRM</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.routeBadgeText}>
              {roadSummary
                ? `${roadSummary.distanceKm} km · about ${roadSummary.durationMin} min · ${roadSummary.profile === "driving" ? "Driving estimate (mapped roads)" : "Walking estimate (mapped paths)"}`
                : routeRoadStatus === "loading"
                  ? "Finding mapped streets…"
                  : "Street route unavailable right now. No route is drawn. Try another option or check your connection."}
            </Text>
            <Text style={styles.routeBadgeNote}>
              {routeMode === "road"
                ? "Blue line: roads mapped for vehicles. Unverified for floods and closures."
                : routeMode === "walk"
                  ? "Teal line: mapped walking paths. Unverified for floods and closures."
                  : `Orange line: mapped road directions to the DRRM-selected center${roadSummary?.viaWaypoints ? ", via DRRM waypoints" : ""}. Unverified for floods and closures; follow official advisories.`}
            </Text>
            <Text style={styles.routeBadgeNote}>
              DRRM graph estimate (not road distance): {routeInfo.distance_km} km · about {routeInfo.est_minutes} min, measured from the {routeInfo.locationSource === "live_gps" ? "live GPS position" : routeInfo.locationSource === "household_gps" ? "saved household location" : "approximate barangay location"}. Used only to pick the center.
            </Text>
            {routeInfo.locationSource !== "live_gps" && (
              <Text style={styles.routeBadgeNote}>
                Starting point: {routeInfo.locationSource === "household_gps" ? "saved household GPS" : "approximate barangay location"}. Tap My Current Location for an updated position.
              </Text>
            )}
          </View>
        ) : null}

        <View style={styles.mapWrap}>
          <WebView
            ref={webviewRef}
            originWhitelist={["*"]}
            source={{ html: MAP_HTML }}
            onMessage={handleWebViewMessage}
            style={styles.map}
          />
          <View style={styles.locationToolbar} pointerEvents="box-none">
            <TouchableOpacity
              onPress={locationAvailable ? centerOnMyLocation : startTracking}
              style={styles.locationButton}
              accessibilityRole="button"
              accessibilityLabel={locationAvailable ? "My Current Location: recenter the map" : "My Current Location: enable GPS"}
              disabled={locating || !mapReady}
            >
              {locating ? <ActivityIndicator size="small" color="#2563eb" /> : <Text style={styles.targetIcon}>◎</Text>}
              <View style={styles.locationTextGroup}>
                <Text style={styles.locationButtonText}>My Current Location</Text>
                <Text style={styles.locationStatus}>{locating ? "Finding GPS…" : locationAvailable ? "Tap to recenter" : "Tap to enable GPS"}</Text>
              </View>
            </TouchableOpacity>
            {locationAvailable && (
              <TouchableOpacity
                onPress={tracking ? stopTracking : toggleTracking}
                style={styles.stopButton}
                accessibilityRole="button"
                accessibilityLabel={tracking ? "Stop live location updates" : "Start live location updates"}
              >
                <Text style={styles.stopButtonText}>{tracking ? "Stop Live" : "Live GPS"}</Text>
              </TouchableOpacity>
            )}
          </View>
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

          {selected && !routeInfo ? (
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
                style={[styles.directionsBtn,
                  (routing || selected.status !== "open" || selected.eligible === false) && styles.directionsBtnDisabled]}
                onPress={() => getDirections(selected)}
                disabled={routing || selected.status !== "open" || selected.eligible === false}
                accessibilityRole="button"
              >
                {routing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <PinIcon color="#fff" />
                    <Text style={styles.directionsBtnText}>
                      {selected.status !== "open" || selected.eligible === false ? "Center Unavailable" : "Route to This Center"}
                    </Text>
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
      </SafeAreaView>
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
  backBtn: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  backBtnText: { fontSize: 26, color: "#0f172a", marginTop: -2 },
  headerTitle: { flex: 1, fontSize: 19, fontWeight: "700", color: UI.navy, textAlign: "center" },
  headerSpacer: { width: 42 },
  locationToolbar: {
    position: "absolute", top: 12, right: 12, zIndex: 8, elevation: 8,
    alignItems: "flex-end", gap: 7, maxWidth: "90%",
  },
  locationButton: {
    minHeight: 48, flexDirection: "row", gap: 10,
    alignItems: "center", paddingHorizontal: 13, paddingVertical: 8,
    borderRadius: 15, borderWidth: 1, borderColor: "#dbeafe", backgroundColor: "#fff",
    shadowColor: "#000", shadowOpacity: 0.12, shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 }, elevation: 5,
  },
  targetIcon: { fontSize: 28, fontWeight: "700", lineHeight: 32, color: "#2563eb" },
  locationTextGroup: { flexShrink: 1 },
  locationButtonText: { fontSize: 14, fontWeight: "700", color: "#1d4ed8" },
  locationStatus: { fontSize: 11, color: "#64748b", marginTop: 1 },
  stopButton: {
    minHeight: 38, paddingHorizontal: 14, justifyContent: "center",
    borderWidth: 1, borderColor: "#d1d5db", borderRadius: 20, backgroundColor: "#fff",
    elevation: 4,
  },
  stopButtonText: { fontSize: 12, color: "#374151", fontWeight: "700" },
  routeActionRow: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 4, backgroundColor: "#fff" },
  recommendedBtn: {
    minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 11, backgroundColor: "#2563eb",
  },
  recommendedBtnText: { fontWeight: "700", fontSize: 15, color: "#fff", flexShrink: 1, textAlign: "center" },
  mapLegend: { flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 20, backgroundColor: "#fff", paddingVertical: 6 },
  legendText: { fontSize: 12, color: UI.label },
  legendOpen: { color: "#15803d", fontSize: 15 },
  legendClosed: { color: "#dc2626", fontSize: 15 },
  mapInstruction: { backgroundColor: "#fff", paddingHorizontal: 12, paddingBottom: 7 },
  mapInstructionText: { textAlign: "center", color: UI.muted, fontSize: 12, lineHeight: 18 },
  mapWrap: { flex: 1, minHeight: 180 },
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
    top: 78,
    left: 12,
    right: 12,
    zIndex: 10,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 10,
    padding: 10,
  },
  errorBannerText: { color: "#9a3412", fontSize: 12 },
  routeBadge: {
    marginHorizontal: 12, marginTop: 6, marginBottom: 7,
    backgroundColor: "#fff", borderRadius: 12, borderWidth: 1,
    borderColor: "#bfdbfe", paddingHorizontal: 12, paddingVertical: 9,
  },
  routeModeRow: { flexDirection: "row", gap: 8, marginVertical: 6 },
  routeModeButton: {
    flex: 1, minWidth: 0, minHeight: 36, justifyContent: "center", alignItems: "center",
    borderRadius: 9, borderWidth: 1, borderColor: "#bfdbfe", backgroundColor: "#eff6ff",
    paddingHorizontal: 6,
  },
  routeModeActive: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  routeModeText: { color: "#1d4ed8", fontWeight: "700", fontSize: 12, textAlign: "center" },
  routeModeTextActive: { color: "#fff" },
  routeBadgeTitle: { color: "#1d4ed8", fontSize: 13, fontWeight: "800", marginBottom: 3 },
  routeBadgeText: { color: "#0f172a", fontSize: 13, fontWeight: "700", lineHeight: 18 },
  routeBadgeNote: { color: "#64748b", fontSize: 11, lineHeight: 16, marginTop: 3 },
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
  detailMeta: { fontSize: 13, color: "#526176", marginTop: 2, flexShrink: 1 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 10 },
  statusPill: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  detailWarning: { fontSize: 13, lineHeight: 19, color: "#9a3412", marginTop: 8 },
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
  directionsBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
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