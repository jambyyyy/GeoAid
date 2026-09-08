import { useEffect, useState, useCallback } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../src/components/MobileShell";
import { QRIcon, PinIcon, ClockIcon, BellIcon } from "../src/components/icons";
import { API_BASE } from "../src/api";

// Shown if barangay/evacuation/dashboard/ hasn't been reached yet (e.g.
// no EvacuationCenter row exists for this barangay yet in Django admin).
const FALLBACK_DATA = {
  staff_name: "Barangay Staff",
  evacuation_center: { id: 0, name: "No center set up yet", occupancy: 0, capacity: 1, status: "closed" },
  pending_registrations: 0,
  today_checkins: 0,
  recent_checkins: [],
};

function StaffDashboardScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    const username = (await AsyncStorage.getItem("geoaid_staff_username")) || "";
    try {
      const response = await fetch(
        `${API_BASE}/api/barangay/evacuation/dashboard/?username=${encodeURIComponent(username)}`
      );
      const json = await response.json();
      if (!response.ok) {
        // Backend returns a helpful { message } for the "no center yet"
        // and "can't determine barangay" cases — surface it instead of
        // silently falling back, since those need an admin fix.
        setLoadError(json.message || "Could not load the evacuation center.");
        setData(FALLBACK_DATA);
        return;
      }
      setLoadError("");
      setData({ ...json, staff_name: username });
    } catch (err) {
      console.warn("Falling back to mock staff dashboard data:", err.message);
      setData(FALLBACK_DATA);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading dashboard…</Text>
        </View>
      </MobileShell>
    );
  }

  const { staff_name, evacuation_center, pending_registrations, today_checkins, recent_checkins = [] } = data;
  const occupancyPct = Math.round((evacuation_center.occupancy / Math.max(1, evacuation_center.capacity)) * 100);

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Signed in as</Text>
            <Text style={styles.staffName}>{staff_name}</Text>
          </View>
          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={async () => {
              await AsyncStorage.removeItem("geoaid_staff_username");
              navigation.replace("StaffLogin");
            }}
          >
            <Text style={styles.logoutText}>Log out</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {loadError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.scanCard, !evacuation_center.id && styles.scanCardDisabled]}
            onPress={() => navigation.navigate("Scanner")}
            disabled={!evacuation_center.id}
          >
            <View style={styles.scanIconWrap}>
              <QRIcon color="#fff" size={26} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.scanTitle}>Scan Resident QR Code</Text>
              <Text style={styles.scanSubtitle}>Check residents in or out at {evacuation_center.name}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <ClockIcon color="#2563eb" />
              <Text style={styles.statValue}>{today_checkins}</Text>
              <Text style={styles.statLabel}>Check-ins Today</Text>
            </View>
            <View style={styles.statCard}>
              <BellIcon color="#b45309" />
              <Text style={styles.statValue}>{pending_registrations}</Text>
              <Text style={styles.statLabel}>Pending Registrations</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Evacuation Center</Text>
            <View style={styles.centerPanel}>
              <View style={styles.centerTop}>
                <Text style={styles.centerName}>{evacuation_center.name}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusPillText}>
                    {evacuation_center.status === "open" ? "OPEN" : "CLOSED"}
                  </Text>
                </View>
              </View>
              <View style={styles.occupancyRow}>
                <Text style={styles.occupancyLabel}>Occupancy</Text>
                <Text style={styles.occupancyLabel}>
                  {evacuation_center.occupancy} / {evacuation_center.capacity}
                </Text>
              </View>
              <View style={styles.occupancyBar}>
                <View style={[styles.occupancyFill, { width: `${occupancyPct}%` }]} />
              </View>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Recent Check-ins</Text>
            {recent_checkins.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyText}>No check-ins recorded yet.</Text>
              </View>
            ) : (
              <View style={styles.list}>
                {recent_checkins.map((c, i) => (
                  <View key={`${c.name}-${i}`} style={styles.checkinRow}>
                    <View style={styles.checkinAvatar}>
                      <PinIcon size={16} color="#2563eb" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.checkinName}>{c.name}</Text>
                      <Text style={styles.checkinMeta}>{c.household}</Text>
                    </View>
                    <Text style={styles.checkinTime}>{c.time}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </View>
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
  staffName: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  logoutBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb" },
  logoutText: { fontSize: 12, fontWeight: "600", color: "#374151" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  errorBox: { backgroundColor: "#fff4e5", borderWidth: 1, borderColor: "#ffdca8", borderRadius: 8, padding: 10 },
  errorText: { color: "#8a5a00", fontSize: 13 },
  scanCard: {
    flexDirection: "row",
    gap: 14,
    alignItems: "center",
    backgroundColor: "#2563eb",
    borderRadius: 16,
    padding: 16,
  },
  scanCardDisabled: { opacity: 0.5 },
  scanIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanTitle: { color: "#fff", fontWeight: "700", fontSize: 15 },
  scanSubtitle: { color: "#dbeafe", fontSize: 12, marginTop: 2 },
  statsRow: { flexDirection: "row", gap: 12 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#eef0f3", gap: 6 },
  statValue: { fontSize: 20, fontWeight: "700", color: "#0f172a" },
  statLabel: { fontSize: 11, color: "#64748b" },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  centerPanel: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#eef0f3" },
  centerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  centerName: { fontWeight: "700", fontSize: 15, color: "#0f172a" },
  statusPill: { backgroundColor: "#dcfce7", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { color: "#15803d", fontSize: 11, fontWeight: "700" },
  occupancyRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  occupancyLabel: { fontSize: 12, color: "#64748b" },
  occupancyBar: { height: 6, backgroundColor: "#eef0f3", borderRadius: 3, marginTop: 6, overflow: "hidden" },
  occupancyFill: { height: 6, backgroundColor: "#2563eb" },
  emptyPanel: { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#eef0f3" },
  emptyText: { fontSize: 13, color: "#64748b", textAlign: "center" },
  list: { gap: 8 },
  checkinRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#eef0f3",
  },
  checkinAvatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: "#eaf3ff", alignItems: "center", justifyContent: "center" },
  checkinName: { fontWeight: "600", fontSize: 13, color: "#111827" },
  checkinMeta: { fontSize: 11, color: "#64748b" },
  checkinTime: { fontSize: 11, color: "#9aa3af" },
});

export default StaffDashboardScreen;