import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { WebView } from "react-native-webview";

import MobileShell from "../components/MobileShell";
import BottomNav from "../components/BottomNav";
import { QRIcon, ClockIcon, PinIcon, PhoneIcon } from "../components/icons";
import { API_BASE } from "../api";
import { mergeResidentStyles } from "../residentPolish";
import {
  loadReliefAlerts,
  markReliefSeen,
  RELIEF_POLL_MS,
} from "../reliefNotifications";

// Do not display fictional evacuation information when offline.
const FALLBACK_DATA = {
  household_name: "Your Household",
  nearest_center: {
    id: null,
    name: "Center information unavailable",
    distance_km: null,
    walk_minutes: null,
    status: "unavailable",
    occupancy: 0,
    capacity: 0,
  },
};

const EVACUATION_TABS = [
  "evacuate",
  "evacuation",
  "evac",
  "map",
  "route",
  "evacuation-map",
  "evacuationMap",
];

// Informational preview only.
// Full directions remain in EvacuationMapScreen.
function buildCenterMiniMapHtml(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);

  return `<!DOCTYPE html>
<html>
<head>
  <meta
    name="viewport"
    content="width=device-width, initial-scale=1,
    maximum-scale=1, user-scalable=no"
  />
  <link
    rel="stylesheet"
    href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
  />
  <style>
    html, body, #map {
      height: 100%;
      width: 100%;
      padding: 0;
      margin: 0;
      background: #edf2f7;
    }
    .leaflet-control-attribution {
      font-size: 8px !important;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    const map = L.map("map", {
      zoomControl: false,
      dragging: false,
      touchZoom: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false
    }).setView([${lat}, ${lng}], 15);

    L.tileLayer(
      "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors"
      }
    ).addTo(map);

    L.circleMarker([${lat}, ${lng}], {
      radius: 10,
      color: "#ffffff",
      weight: 3,
      fillColor: "#2563eb",
      fillOpacity: 1
    }).addTo(map);
  </script>
</body>
</html>`;
}

function reliefStatusDetails(status) {
  switch (status) {
    case "ready":
      return {
        label: "READY FOR PICKUP",
        detail: "Your relief goods are ready. View pickup details.",
      };
    case "processing":
      return {
        label: "BEING PREPARED",
        detail: "Your household's relief allocation is being prepared.",
      };
    case "received":
    case "claimed":
      return {
        label: "RELIEF RECEIVED",
        detail: "Review your received relief goods and history.",
      };
    case "pending":
      return {
        label: "AWAITING ALLOCATION",
        detail: "Check for updates on your household's relief goods.",
      };
    case "not_eligible":
      return {
        label: "REGISTRATION REVIEW",
        detail: "Registration confirmation is required.",
      };
    default:
      return {
        label: "CHECK RELIEF STATUS",
        detail: "See your household's current relief information.",
      };
  }
}

function HomeScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("home");
  const [reliefStatus, setReliefStatus] = useState(null);
  // New relief updates the resident has not been told about yet.
  const [reliefAlerts, setReliefAlerts] = useState([]);

  const [previewCenter, setPreviewCenter] = useState(null);
  const [previewState, setPreviewState] = useState("idle");
  const [previewError, setPreviewError] = useState(false);

  // Initial resident dashboard.
  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      try {
        const mobileNumber =
          (await AsyncStorage.getItem("geoaid_resident_mobile")) || "";

        if (!mobileNumber) {
          throw new Error("Resident mobile number unavailable");
        }

        const response = await fetch(
          `${API_BASE}/api/resident/dashboard/?mobile_number=${encodeURIComponent(
            mobileNumber,
          )}`,
        );

        if (!response.ok) {
          throw new Error(`Dashboard request failed (${response.status})`);
        }

        const json = await response.json();

        if (active) {
          setData(json);
        }
      } catch (error) {
        console.warn("Unable to load resident dashboard:", error.message);

        if (active) {
          setData(FALLBACK_DATA);
        }
      }
    };

    loadDashboard();

    return () => {
      active = false;
    };
  }, []);

  // Refresh relief status (and any new-relief alert) whenever residents
  // return to Home, and re-check every 30s while Home is on screen.
  useEffect(() => {
    let active = true;

    const refreshRelief = async () => {
      try {
        const { status, alerts } = await loadReliefAlerts();

        if (active) {
          setReliefStatus(status);
          setReliefAlerts(alerts);
        }
      } catch {
        if (active) {
          setReliefStatus(null);
        }
      }
    };

    const unsubscribe = navigation.addListener("focus", () => {
      setActiveTab("home");
      refreshRelief();
    });

    const timer = setInterval(() => {
      if (navigation.isFocused()) refreshRelief();
    }, RELIEF_POLL_MS);

    refreshRelief();

    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [navigation]);

  const recommendedCenterId = data?.nearest_center?.id;

  // Fetch actual center coordinates from the DRRM map.
  // No fabricated or hardcoded center locations.
  useEffect(() => {
    let active = true;

    setPreviewCenter(null);
    setPreviewError(false);

    if (!recommendedCenterId) {
      setPreviewState("unavailable");
      return () => {
        active = false;
      };
    }

    setPreviewState("loading");

    const fetchPreview = async () => {
      try {
        const response = await fetch(`${API_BASE}/api/drrm/map/`);

        if (!response.ok) {
          throw new Error("Evacuation map unavailable");
        }

        const json = await response.json();

        const center = (json.centers || []).find(
          (item) => String(item.id) === String(recommendedCenterId),
        );

        const latitude =
          center?.latitude == null ? NaN : Number(center.latitude);

        const longitude =
          center?.longitude == null ? NaN : Number(center.longitude);

        if (
          !center ||
          !Number.isFinite(latitude) ||
          !Number.isFinite(longitude) ||
          Math.abs(latitude) > 90 ||
          Math.abs(longitude) > 180
        ) {
          throw new Error("Valid center coordinates unavailable");
        }

        if (active) {
          setPreviewCenter({
            latitude,
            longitude,
            approximate: Boolean(center.approximate),
          });
          setPreviewState("ready");
        }
      } catch (error) {
        console.warn("Mini map preview:", error.message);

        if (active) {
          setPreviewCenter(null);
          setPreviewState("unavailable");
        }
      }
    };

    fetchPreview();

    return () => {
      active = false;
    };
  }, [recommendedCenterId]);

  const previewHtml = useMemo(() => {
    if (!previewCenter) return "";

    return buildCenterMiniMapHtml(
      previewCenter.latitude,
      previewCenter.longitude,
    );
  }, [previewCenter?.latitude, previewCenter?.longitude]);

  if (!data) {
    return (
      <MobileShell>
        <SafeAreaView style={styles.loading} edges={["top"]}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading your dashboard...</Text>
        </SafeAreaView>
      </MobileShell>
    );
  }

  const householdName = data.household_name || "Your Household";
  const nearestCenter = data.nearest_center || FALLBACK_DATA.nearest_center;

  const hasCenter = Boolean(nearestCenter.id);

  const occupancyPct =
    hasCenter && Number(nearestCenter.capacity) > 0
      ? Math.min(
          100,
          Math.max(
            0,
            Math.round(
              (Number(nearestCenter.occupancy || 0) /
                Number(nearestCenter.capacity)) *
                100,
            ),
          ),
        )
      : 0;

  const relief = reliefStatusDetails(reliefStatus);

  const routeDescription =
    hasCenter && nearestCenter.distance_km != null
      ? `About ${nearestCenter.distance_km} km (DRRM estimate from your ${
          nearestCenter.start_source === "household_gps"
            ? "saved household location"
            : "barangay location"
        })${
          nearestCenter.walk_minutes != null
            ? ` · about ${nearestCenter.walk_minutes} min`
            : ""
        }. Open the map for road distance from your GPS.`
      : "Check the map for available evacuation centers.";

  const topAlert = reliefAlerts[0] || null;

  const dismissReliefAlerts = () => {
    markReliefSeen(reliefAlerts);
    setReliefAlerts([]);
  };

  const openReliefFromAlert = () => {
    dismissReliefAlerts();
    navigation.navigate("ReliefDistribution");
  };

  const handleTabSelect = (tab) => {
    if (tab === "profile") {
      navigation.navigate("Profile");
    } else if (EVACUATION_TABS.includes(tab)) {
      navigation.navigate("EvacuationMap");
    } else {
      setActiveTab(tab);
    }
  };

  const openRoute = () => {
    if (hasCenter) {
      navigation.navigate("EvacuationMap", {
        focusCenterId: nearestCenter.id,
      });
    } else {
      navigation.navigate("EvacuationMap");
    }
  };

  return (
    <MobileShell>
      <SafeAreaView style={styles.screen} edges={["top"]}>
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.greeting}>Welcome to GeoAid</Text>
          <Text style={styles.householdName} numberOfLines={2}>
            {householdName}
          </Text>
          <Text style={styles.headerSubtitle}>
            Your household's safety and assistance hub
          </Text>
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.body}
          showsVerticalScrollIndicator={false}
          bounces
        >
          {/* NEW RELIEF NOTIFICATION */}
          {topAlert && (
            <View
              style={[
                styles.alertBanner,
                topAlert.stage === "ready" && styles.alertBannerReady,
              ]}
              accessibilityRole="alert"
            >
              <TouchableOpacity
                style={styles.alertBannerMain}
                onPress={openReliefFromAlert}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${topAlert.title}. View relief details`}
              >
                <Text style={styles.alertBannerIcon}>
                  {topAlert.stage === "ready" ? "✅" : "📦"}
                </Text>
                <View style={styles.alertBannerText}>
                  <Text
                    style={[
                      styles.alertBannerTitle,
                      topAlert.stage === "ready" &&
                        styles.alertBannerTitleReady,
                    ]}
                  >
                    {topAlert.title}
                  </Text>
                  <Text style={styles.alertBannerMessage}>
                    {topAlert.message}
                  </Text>
                  {reliefAlerts.length > 1 && (
                    <Text style={styles.alertBannerMore}>
                      +{reliefAlerts.length - 1} more relief update
                      {reliefAlerts.length - 1 > 1 ? "s" : ""}
                    </Text>
                  )}
                  <Text style={styles.alertBannerLink}>View details →</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={dismissReliefAlerts}
                style={styles.alertBannerClose}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                accessibilityRole="button"
                accessibilityLabel="Dismiss relief notification"
              >
                <Text style={styles.alertBannerCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* EXISTING QUICK ACTIONS */}
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, styles.qrAction]}
              onPress={() => navigation.navigate("QRCode")}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Open My QR Code"
            >
              <QRIcon />
              <Text style={styles.quickActionLabel}>My QR Code</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.quickAction, styles.registrationAction]}
              onPress={() => navigation.navigate("RegistrationStatus")}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Check Registration Status"
            >
              <ClockIcon />
              <Text style={styles.quickActionLabel}>Registration</Text>
            </TouchableOpacity>
          </View>

          {/* EMERGENCY CONTACTS */}
          <TouchableOpacity
            style={styles.emergencyContactsBtn}
            onPress={() => navigation.navigate("EmergencyContacts")}
            activeOpacity={0.8}
            accessibilityRole="button"
          >
            <View style={styles.emergencyIconContainer}>
              <PhoneIcon color="#dc2626" />
            </View>

            <View style={styles.emergencyContactsText}>
              <Text style={styles.emergencyContactsTitle}>
                Emergency Contacts
              </Text>
              <Text style={styles.emergencyContactsSubtitle}>
                Quickly reach important emergency numbers
              </Text>
            </View>

            <Text style={styles.emergencyArrow}>›</Text>
          </TouchableOpacity>

          {/* HIGHLIGHTED RELIEF DISTRIBUTION */}
          <TouchableOpacity
            style={styles.reliefAction}
            onPress={() => navigation.navigate("ReliefDistribution")}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="View household relief goods, pickup status and distribution history"
          >
            <View style={styles.reliefHeader}>
              <View style={styles.reliefIconContainer}>
                <Text style={styles.reliefIcon}>📦</Text>
              </View>

              <View style={styles.reliefBadge}>
                <Text style={styles.reliefBadgeText}>
                  RELIEF GOODS ASSISTANCE
                </Text>
              </View>
            </View>

            <Text style={[styles.reliefActionTitle, { color: "#ffffff" }]}>
              Relief Distribution
            </Text>

            <Text style={[styles.reliefActionSubtitle, { color: "#eff6ff" }]}>
              Check relief goods allocated to your household, find out if they
              are ready for pickup, and view your distribution history.
            </Text>

            <View style={styles.reliefStatusRow}>
              <View style={styles.reliefStatusDot} />
              <View style={styles.reliefStatusContent}>
                <Text style={[styles.reliefStatusTitle, { color: "#ffffff" }]}>
                  {relief.label}
                </Text>
                <Text style={[styles.reliefStatusDetail, { color: "#eff6ff" }]}>
                  {relief.detail}
                </Text>
              </View>
            </View>

            <View style={styles.reliefCta}>
              <Text style={styles.reliefCtaText}>View My Relief Goods</Text>
              <Text style={styles.reliefCtaArrow}>→</Text>
            </View>
          </TouchableOpacity>

          {/* RECOMMENDED EVACUATION CENTER */}
          <View style={styles.section}>
            <View style={styles.sectionHeadingRow}>
              <Text style={styles.sectionLabel}>
                Recommended Evacuation Center
              </Text>
            </View>

            <View style={styles.centerPanel}>
              <View style={styles.centerTop}>
                <View style={styles.centerInfo}>
                  <Text style={styles.centerName} numberOfLines={2}>
                    {hasCenter
                      ? nearestCenter.name
                      : "Center information unavailable"}
                  </Text>

                  <Text style={styles.centerMeta}>{routeDescription}</Text>
                </View>

                <View
                  style={[
                    styles.statusPill,
                    nearestCenter.status === "closed" &&
                      styles.statusPillClosed,
                    (!hasCenter ||
                      !["open", "closed"].includes(nearestCenter.status)) &&
                      styles.statusPillUnknown,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      nearestCenter.status === "closed" &&
                        styles.statusPillTextClosed,
                      (!hasCenter ||
                        !["open", "closed"].includes(nearestCenter.status)) &&
                        styles.statusPillTextUnknown,
                    ]}
                  >
                    {hasCenter && nearestCenter.status === "open"
                      ? "OPEN"
                      : hasCenter && nearestCenter.status === "closed"
                        ? "CLOSED"
                        : "UNKNOWN"}
                  </Text>
                </View>
              </View>

              {/* MINI MAP PREVIEW */}
              <View style={styles.miniMapSection}>
                <View style={styles.miniMapHeadingRow}>
                  <PinIcon color="#2563eb" />
                  <Text style={styles.miniMapHeading}>
                    Center Location Preview
                  </Text>
                </View>

                {previewCenter && !previewError ? (
                  <View style={styles.miniMapFrame}>
                    <WebView
                      key={`${previewCenter.latitude}-${previewCenter.longitude}`}
                      originWhitelist={["*"]}
                      source={{ html: previewHtml }}
                      javaScriptEnabled
                      scrollEnabled={false}
                      bounces={false}
                      onError={() => setPreviewError(true)}
                      pointerEvents="none"
                      style={styles.miniMapWeb}
                    />
                  </View>
                ) : (
                  <View style={styles.miniMapUnavailable}>
                    {previewState === "loading" ? (
                      <ActivityIndicator size="small" color="#2563eb" />
                    ) : (
                      <PinIcon color="#64748b" />
                    )}

                    <Text style={styles.miniMapUnavailableText}>
                      {previewState === "loading"
                        ? "Loading center location..."
                        : "Location preview unavailable. Open the evacuation map to view available centers."}
                    </Text>
                  </View>
                )}

                <Text style={styles.miniMapNote}>
                  {previewCenter?.approximate
                    ? "Approximate barangay location only. This is not the exact center location."
                    : previewCenter
                      ? "Map preview of the evacuation center. Open the full map to see directions."
                      : "Location information may be unavailable until DRRM provides coordinates."}
                </Text>
              </View>

              {/* OCCUPANCY */}
              <View style={styles.occupancyRow}>
                <Text style={styles.occupancyLabel}>Center Occupancy</Text>

                <Text style={styles.occupancyValue}>
                  {hasCenter && nearestCenter.capacity
                    ? `${nearestCenter.occupancy} / ${nearestCenter.capacity}`
                    : "Not available"}
                </Text>
              </View>

              <View style={styles.occupancyBar}>
                <View
                  style={[styles.occupancyFill, { width: `${occupancyPct}%` }]}
                />
              </View>

              <Text style={styles.centerSafetyNote}>
                GeoAid uses recorded DRRM information for its recommendation.
                Check official advisories for current road and evacuation
                safety.
              </Text>

              {/* KEEP VIEW ROUTE BUTTON PROMINENT */}
              <TouchableOpacity
                style={styles.directionsBtn}
                activeOpacity={0.8}
                onPress={openRoute}
                accessibilityRole="button"
                accessibilityLabel="View evacuation route on map"
              >
                <PinIcon color="#ffffff" />

                <Text style={styles.directionsBtnText}>
                  {hasCenter ? "View Route on Map" : "View Evacuation Map"}
                </Text>

                <Text style={styles.directionsArrow}>→</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* PRESERVED EVACUATION DIRECTIONS SHORTCUT */}
          <TouchableOpacity
            style={styles.routeAction}
            onPress={() => navigation.navigate("EvacuationMap")}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Find recommended evacuation directions"
          >
            <View style={styles.routeTextContainer}>
              <Text style={styles.routeActionTitle}>Evacuation Directions</Text>
              <Text style={styles.routeActionSubtitle}>
                Explore evacuation centers and compare route options
              </Text>
            </View>
            <Text style={styles.routeArrow}>›</Text>
          </TouchableOpacity>
        </ScrollView>

        <BottomNav active={activeTab} onSelect={handleTabSelect} />
      </SafeAreaView>
    </MobileShell>
  );
}

const styles = StyleSheet.create(
  mergeResidentStyles(
    {
      loading: {
        flex: 1,
        justifyContent: "center",
        alignItems: "center",
        backgroundColor: "#f5f7fa",
        gap: 12,
      },
      loadingText: {
        color: "#64748b",
        fontSize: 13,
      },
      screen: {
        flex: 1,
        width: "100%",
        backgroundColor: "#f5f7fa",
      },
      header: {
        width: "100%",
        paddingHorizontal: 20,
        paddingTop: 6,
        paddingBottom: 12,
        flexShrink: 0,
      },
      greeting: {
        fontSize: 13,
        lineHeight: 18,
        color: "#64748b",
      },
      householdName: {
        marginTop: 2,
        fontSize: 21,
        lineHeight: 27,
        fontWeight: "800",
        color: "#0f172a",
      },
      headerSubtitle: {
        fontSize: 12,
        lineHeight: 18,
        color: "#64748b",
        marginTop: 3,
      },
      scrollView: {
        flex: 1,
        width: "100%",
      },
      body: {
        paddingHorizontal: 18,
        paddingTop: 3,
        paddingBottom: 30,
        gap: 16,
        flexGrow: 0,
      },

      // NEW RELIEF NOTIFICATION BANNER
      alertBanner: {
        width: "100%",
        flexDirection: "row",
        alignItems: "flex-start",
        backgroundColor: "#eff6ff",
        borderWidth: 1,
        borderColor: "#93c5fd",
        borderRadius: 14,
        paddingVertical: 12,
        paddingLeft: 13,
        paddingRight: 8,
      },
      alertBannerReady: {
        backgroundColor: "#f0fdf4",
        borderColor: "#86efac",
      },
      alertBannerMain: {
        flex: 1,
        minWidth: 0,
        flexDirection: "row",
        gap: 10,
      },
      alertBannerIcon: {
        fontSize: 22,
        lineHeight: 28,
      },
      alertBannerText: {
        flex: 1,
        minWidth: 0,
      },
      alertBannerTitle: {
        fontSize: 14,
        lineHeight: 20,
        fontWeight: "800",
        color: "#1d4ed8",
      },
      alertBannerTitleReady: {
        color: "#166534",
      },
      alertBannerMessage: {
        fontSize: 12,
        lineHeight: 18,
        color: "#334155",
        marginTop: 2,
      },
      alertBannerMore: {
        fontSize: 11,
        lineHeight: 16,
        color: "#64748b",
        marginTop: 4,
      },
      alertBannerLink: {
        fontSize: 12,
        fontWeight: "800",
        color: "#1d4ed8",
        marginTop: 6,
      },
      alertBannerClose: {
        paddingHorizontal: 8,
        paddingVertical: 2,
      },
      alertBannerCloseText: {
        fontSize: 15,
        color: "#64748b",
      },

      // QUICK ACTIONS
      quickActions: {
        flexDirection: "row",
        gap: 10,
        width: "100%",
      },
      quickAction: {
        flex: 1,
        minWidth: 0,
        minHeight: 78,
        paddingHorizontal: 10,
        paddingVertical: 12,
        borderRadius: 14,
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
      },
      qrAction: {
        backgroundColor: "#eaf0fb",
      },
      registrationAction: {
        backgroundColor: "#fdf1e3",
      },
      quickActionLabel: {
        fontSize: 12,
        lineHeight: 17,
        fontWeight: "700",
        color: "#374151",
        textAlign: "center",
        flexShrink: 1,
      },

      // EMERGENCY CONTACTS
      emergencyContactsBtn: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        backgroundColor: "#fee2e2",
        borderRadius: 14,
        borderWidth: 1,
        borderColor: "#fecaca",
        paddingHorizontal: 15,
        paddingVertical: 15,
      },
      emergencyIconContainer: {
        width: 38,
        height: 38,
        borderRadius: 11,
        backgroundColor: "#fff5f5",
        alignItems: "center",
        justifyContent: "center",
      },
      emergencyContactsText: {
        flex: 1,
        minWidth: 0,
      },
      emergencyContactsTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: "#b91c1c",
      },
      emergencyContactsSubtitle: {
        fontSize: 12,
        color: "#dc2626",
        lineHeight: 17,
        marginTop: 3,
      },
      emergencyArrow: {
        fontSize: 25,
        color: "#b91c1c",
      },

      // HIGHLIGHTED RELIEF DISTRIBUTION
      reliefAction: {
        width: "100%",
        backgroundColor: "#1d4ed8",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "#1e40af",
        padding: 17,
        shadowColor: "#1d4ed8",
        shadowOpacity: 0.15,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      },
      reliefHeader: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        marginBottom: 12,
      },
      reliefIconContainer: {
        width: 43,
        height: 43,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.18)",
        alignItems: "center",
        justifyContent: "center",
      },
      reliefIcon: {
        fontSize: 23,
      },
      reliefBadge: {
        maxWidth: "100%",
        backgroundColor: "rgba(255,255,255,0.16)",
        paddingHorizontal: 10,
        paddingVertical: 7,
        borderRadius: 20,
      },
      reliefBadgeText: {
        color: "#ffffff",
        fontSize: 10,
        fontWeight: "800",
        letterSpacing: 0.3,
      },
      reliefActionTitle: {
        fontSize: 20,
        lineHeight: 26,
        fontWeight: "800",
        color: "#ffffff",
      },
      reliefActionSubtitle: {
        fontSize: 12,
        lineHeight: 19,
        color: "#dbeafe",
        marginTop: 6,
      },
      reliefStatusRow: {
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 9,
        padding: 11,
        borderRadius: 11,
        marginTop: 14,
        backgroundColor: "rgba(255,255,255,0.13)",
      },
      reliefStatusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: "#ffffff",
        marginTop: 4,
      },
      reliefStatusContent: {
        flex: 1,
        minWidth: 0,
      },
      reliefStatusTitle: {
        color: "#ffffff",
        fontWeight: "800",
        fontSize: 11,
        letterSpacing: 0.3,
      },
      reliefStatusDetail: {
        fontSize: 11,
        lineHeight: 17,
        color: "#dbeafe",
        marginTop: 3,
      },
      reliefCta: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        paddingVertical: 13,
        paddingHorizontal: 12,
        borderRadius: 11,
        backgroundColor: "#ffffff",
        marginTop: 14,
      },
      reliefCtaText: {
        fontSize: 14,
        fontWeight: "800",
        color: "#1d4ed8",
      },
      reliefCtaArrow: {
        fontSize: 19,
        fontWeight: "700",
        color: "#1d4ed8",
      },

      // EVACUATION CENTER
      section: {
        width: "100%",
      },
      sectionHeadingRow: {
        marginBottom: 9,
      },
      sectionLabel: {
        color: "#334155",
        fontWeight: "800",
        fontSize: 15,
        lineHeight: 21,
      },
      centerPanel: {
        width: "100%",
        borderRadius: 16,
        padding: 15,
        backgroundColor: "#ffffff",
        borderWidth: 1,
        borderColor: "#e2e8f0",
      },
      centerTop: {
        flexDirection: "row",
        alignItems: "flex-start",
        justifyContent: "space-between",
        gap: 10,
      },
      centerInfo: {
        flex: 1,
        minWidth: 0,
      },
      centerName: {
        fontSize: 16,
        lineHeight: 22,
        fontWeight: "800",
        color: "#0f172a",
      },
      centerMeta: {
        fontSize: 12,
        lineHeight: 18,
        color: "#64748b",
        marginTop: 4,
      },
      statusPill: {
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 14,
        backgroundColor: "#dcfce7",
        flexShrink: 0,
      },
      statusPillText: {
        fontSize: 10,
        fontWeight: "800",
        color: "#15803d",
      },
      statusPillClosed: {
        backgroundColor: "#fee2e2",
      },
      statusPillTextClosed: {
        color: "#b91c1c",
      },
      statusPillUnknown: {
        backgroundColor: "#e2e8f0",
      },
      statusPillTextUnknown: {
        color: "#475569",
      },

      // MINI MAP
      miniMapSection: {
        width: "100%",
        marginTop: 16,
      },
      miniMapHeadingRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        marginBottom: 9,
      },
      miniMapHeading: {
        fontSize: 13,
        fontWeight: "700",
        color: "#334155",
      },
      miniMapFrame: {
        width: "100%",
        height: 170,
        borderWidth: 1,
        borderColor: "#dbe3ed",
        backgroundColor: "#edf2f7",
        borderRadius: 12,
        overflow: "hidden",
      },
      miniMapWeb: {
        flex: 1,
        backgroundColor: "#edf2f7",
      },
      miniMapUnavailable: {
        minHeight: 145,
        backgroundColor: "#eff6ff",
        borderRadius: 12,
        justifyContent: "center",
        alignItems: "center",
        paddingHorizontal: 18,
        gap: 10,
      },
      miniMapUnavailableText: {
        fontSize: 12,
        lineHeight: 18,
        color: "#64748b",
        textAlign: "center",
      },
      miniMapNote: {
        color: "#64748b",
        fontSize: 11,
        lineHeight: 16,
        marginTop: 7,
      },

      // OCCUPANCY
      occupancyRow: {
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        marginTop: 16,
      },
      occupancyLabel: {
        fontSize: 12,
        color: "#64748b",
      },
      occupancyValue: {
        fontSize: 12,
        fontWeight: "700",
        color: "#334155",
      },
      occupancyBar: {
        height: 7,
        width: "100%",
        backgroundColor: "#eef0f3",
        borderRadius: 5,
        overflow: "hidden",
        marginTop: 8,
      },
      occupancyFill: {
        height: "100%",
        backgroundColor: "#2563eb",
        borderRadius: 5,
      },
      centerSafetyNote: {
        fontSize: 11,
        lineHeight: 17,
        color: "#64748b",
        marginTop: 12,
      },

      // VIEW ROUTE BUTTON
      directionsBtn: {
        width: "100%",
        minHeight: 49,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 9,
        backgroundColor: "#2563eb",
        borderRadius: 12,
        paddingHorizontal: 13,
        paddingVertical: 12,
        marginTop: 15,
      },
      directionsBtnText: {
        color: "#ffffff",
        fontSize: 14,
        fontWeight: "800",
        flexShrink: 1,
      },
      directionsArrow: {
        color: "#ffffff",
        fontSize: 19,
        fontWeight: "700",
      },

      // EXISTING DIRECTIONS SHORTCUT
      routeAction: {
        width: "100%",
        minHeight: 72,
        backgroundColor: "#eff6ff",
        borderWidth: 1,
        borderColor: "#bfdbfe",
        borderRadius: 13,
        paddingHorizontal: 15,
        paddingVertical: 13,
        flexDirection: "row",
        alignItems: "center",
      },
      routeTextContainer: {
        flex: 1,
        minWidth: 0,
      },
      routeActionTitle: {
        fontSize: 15,
        fontWeight: "700",
        color: "#1d4ed8",
      },
      routeActionSubtitle: {
        fontSize: 12,
        lineHeight: 18,
        marginTop: 4,
        color: "#475569",
      },
      routeArrow: {
        fontSize: 27,
        color: "#2563eb",
        marginLeft: 9,
      },
    },
    "home",
  ),
);

export default HomeScreen;
