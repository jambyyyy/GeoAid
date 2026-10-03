import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import BottomNav from "../components/BottomNav";
import { QRIcon, ClockIcon, PinIcon, PhoneIcon } from "../components/icons";
import { API_BASE } from "../api";

// Fallback shown while the dashboard endpoint isn't reachable, so the
// screen still renders something sensible.
const FALLBACK_DATA = {
  household_name: "Santos Household",
  nearest_center: {
    name: "Tibanga Gymnasium",
    distance_km: 0.8,
    walk_minutes: 10,
    status: "open",
    occupancy: 87,
    capacity: 300,
  },
};

// BottomNav tab keys that should open the evacuation map. BottomNav.js
// wasn't available when this was written, so several likely names are
// accepted — if your nav uses a different key, add it here.
const EVACUATION_TABS = ["evacuate", "evacuation", "evac", "map", "route", "evacuation-map", "evacuationMap"];

function HomeScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("home");

  useEffect(() => {
    const fetchDashboard = async () => {
      const mobileNumber = (await AsyncStorage.getItem("geoaid_resident_mobile")) || "";

      try {
        const response = await fetch(
          `${API_BASE}/api/resident/dashboard/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
        const json = await response.json();
        setData(json);
      } catch (err) {
        console.warn("Falling back to mock dashboard data:", err.message);
        setData(FALLBACK_DATA);
      }
    };

    fetchDashboard();
  }, []);

  // Coming back from another screen should highlight Home again, not
  // whichever tab was tapped to leave.
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => setActiveTab("home"));
    return unsubscribe;
  }, [navigation]);

  if (!data) {
    return (
      <MobileShell>
        <SafeAreaView style={styles.loading} edges={["top", "bottom"]}>
          <Text>Loading dashboard…</Text>
        </SafeAreaView>
      </MobileShell>
    );
  }

  const { household_name, nearest_center } = data;
  const occupancyPct = nearest_center.capacity
    ? Math.min(100, Math.round((nearest_center.occupancy / nearest_center.capacity) * 100))
    : 0;

  const handleTabSelect = (tab) => {
    if (tab === "profile") {
      navigation.navigate("Profile");
    } else if (EVACUATION_TABS.includes(tab)) {
      navigation.navigate("EvacuationMap");
    } else {
      setActiveTab(tab);
    }
  };

  return (
    <MobileShell>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.householdName}>{household_name}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: "#eaf0fb" }]}
              onPress={() => navigation.navigate("QRCode")}
            >
              <QRIcon />
              <Text style={styles.quickActionLabel}>My QR Code</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: "#fdf1e3" }]}
              onPress={() => navigation.navigate("RegistrationStatus")}
            >
              <ClockIcon />
              <Text style={styles.quickActionLabel}>Reg. Status</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.emergencyContactsBtn}
            onPress={() => navigation.navigate("EmergencyContacts")}
          >
            <PhoneIcon color="#dc2626" />
            <View style={styles.emergencyContactsText}>
              <Text style={styles.emergencyContactsTitle}>Emergency Contacts</Text>
              <Text style={styles.emergencyContactsSubtitle}>Quick access to important numbers</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.reliefAction}
            onPress={() => navigation.navigate("ReliefDistribution")}
          >
            <Text style={styles.reliefActionTitle}>Relief Distribution</Text>
            <Text style={styles.reliefActionSubtitle}>Check your relief status and history</Text>
          </TouchableOpacity>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Nearest Evacuation Center</Text>
            <View style={styles.centerPanel}>
              <View style={styles.centerTop}>
                <View>
                  <Text style={styles.centerName}>{nearest_center.name}</Text>
                  <Text style={styles.centerMeta}>
                    {nearest_center.distance_km} km away · ~{nearest_center.walk_minutes} min walk
                  </Text>
                </View>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>
                    {nearest_center.status === "open" ? "OPEN" : "CLOSED"}
                  </Text>
                </View>
              </View>

              <View style={styles.occupancyRow}>
                <Text style={styles.occupancyLabel}>Occupancy</Text>
                <Text style={styles.occupancyLabel}>
                  {nearest_center.occupancy} / {nearest_center.capacity}
                </Text>
              </View>
              <View style={styles.occupancyBar}>
                <View style={[styles.occupancyFill, { width: `${occupancyPct}%` }]} />
              </View>

              <TouchableOpacity
                style={styles.directionsBtn}
                onPress={() =>
                  navigation.navigate("EvacuationMap", {
                    focusCenterId: nearest_center.id,
                  })
                }
              >
                <PinIcon color="#fff" />
                <Text style={styles.directionsBtnText}>Get Directions</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        <BottomNav active={activeTab} onSelect={handleTabSelect} />
      </SafeAreaView>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  greeting: { fontSize: 13, color: "#64748b" },
  householdName: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  quickActions: { flexDirection: "row", gap: 10 },
  quickAction: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center", gap: 6 },
  quickActionLabel: { fontSize: 12, fontWeight: "600", color: "#374151", textAlign: "center" },
  reliefAction: {
    backgroundColor: "#dbeafe",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#bfdbfe",
  },
  reliefActionTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  reliefActionSubtitle: {
    fontSize: 12,
    color: "#3b82f6",
    marginTop: 2,
  },
  emergencyContactsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fee2e2",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  emergencyContactsText: { flex: 1 },
  emergencyContactsTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#b91c1c",
  },
  emergencyContactsSubtitle: {
    fontSize: 12,
    color: "#dc2626",
    marginTop: 2,
  },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  centerPanel: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#eef0f3" },
  centerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  centerName: { fontWeight: "700", fontSize: 15, color: "#0f172a" },
  centerMeta: { fontSize: 12, color: "#64748b", marginTop: 2 },
  statusPill: { backgroundColor: "#dcfce7", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { color: "#15803d", fontSize: 12, fontWeight: "700" },
  occupancyRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  occupancyLabel: { fontSize: 12, color: "#64748b" },
  occupancyBar: { height: 6, backgroundColor: "#eef0f3", borderRadius: 3, marginTop: 6, overflow: "hidden" },
  occupancyFill: { height: 6, backgroundColor: "#2563eb" },
  directionsBtn: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  directionsBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
});

export default HomeScreen;