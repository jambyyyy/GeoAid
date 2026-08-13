import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import BottomNav from "../components/BottomNav";
import { BellIcon, WarnIcon, NavIconArrow, QRIcon, ClockIcon, PinIcon } from "../components/icons";
import { API_BASE } from "../api";

const FLAG_STYLE = {
  "4Ps": { backgroundColor: "#eaf3ff", color: "#0b4a8f" },
  PWD: { backgroundColor: "#f3e8ff", color: "#7e22ce" },
  Pregnant: { backgroundColor: "#fce7f3", color: "#be185d" },
  Elderly: { backgroundColor: "#fef3c7", color: "#b45309" },
  "Child<5": { backgroundColor: "#dcfce7", color: "#15803d" },
};

// Fallback shown while the dashboard endpoint doesn't exist yet /
// isn't reachable, so the screen still resembles the mockup. No
// members here — those only ever come from what the resident actually
// entered in Steps 3-4 of registration.
const FALLBACK_DATA = {
  household_name: "Santos Household",
  unread_alerts: 2,
  advisory: {
    title: "Flood Advisory — Tibanga",
    body: "PAGASA: Heavy rainfall expected. Prepare go-bag. Issued 7:45 AM",
  },
  nearest_center: {
    name: "Tibanga Gymnasium",
    distance_km: 0.8,
    walk_minutes: 10,
    status: "open",
    occupancy: 87,
    capacity: 300,
  },
  members: [],
};

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

  if (!data) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading dashboard…</Text>
        </View>
      </MobileShell>
    );
  }

  const { household_name, unread_alerts, advisory, nearest_center, members = [] } = data;
  const occupancyPct = Math.round((nearest_center.occupancy / nearest_center.capacity) * 100);

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Good morning,</Text>
            <Text style={styles.householdName}>{household_name}</Text>
          </View>
          <TouchableOpacity style={styles.bellBtn} accessibilityLabel="Notifications">
            <BellIcon />
            {unread_alerts > 0 && (
              <View style={styles.bellBadge}>
                <Text style={styles.bellBadgeText}>{unread_alerts}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {advisory && (
            <View style={styles.advisoryCard}>
              <WarnIcon color="#b45309" />
              <View style={styles.advisoryText}>
                <Text style={styles.advisoryTitle}>{advisory.title}</Text>
                <Text style={styles.advisoryBody}>{advisory.body}</Text>
              </View>
            </View>
          )}

          <View style={styles.quickActions}>
            <TouchableOpacity
              style={[styles.quickAction, { backgroundColor: "#e9f7ee" }]}
              onPress={() => setActiveTab("evacuation")}
            >
              <NavIconArrow />
              <Text style={styles.quickActionLabel}>Evacuation Route</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickAction, { backgroundColor: "#eaf0fb" }]}>
              <QRIcon />
              <Text style={styles.quickActionLabel}>My QR Code</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.quickAction, { backgroundColor: "#fdf1e3" }]}>
              <ClockIcon />
              <Text style={styles.quickActionLabel}>Reg. Status</Text>
            </TouchableOpacity>
          </View>

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

              <TouchableOpacity style={styles.directionsBtn}>
                <PinIcon color="#fff" />
                <Text style={styles.directionsBtnText}>Get Directions</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Household Members ({members.length})</Text>
            {members.length === 0 ? (
              <View style={styles.membersEmpty}>
                <Text style={styles.membersEmptyText}>
                  No household members on file yet. Finish registration Steps 3-4 to add them here.
                </Text>
              </View>
            ) : (
              <View style={styles.membersList}>
                {members.map((m, i) => (
                  <View key={`${m.name}-${i}`} style={styles.memberRow}>
                    <View style={styles.memberAvatar} />
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{m.name}</Text>
                      <Text style={styles.memberRole}>{m.role}</Text>
                    </View>
                    {m.flags?.length > 0 && (
                      <View style={styles.memberFlags}>
                        {m.flags.map((f) => (
                          <View
                            key={f}
                            style={[styles.flagBadge, { backgroundColor: FLAG_STYLE[f]?.backgroundColor || "#eee" }]}
                          >
                            <Text style={{ color: FLAG_STYLE[f]?.color || "#333", fontSize: 11, fontWeight: "600" }}>
                              {f}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>

        <BottomNav
          active={activeTab}
          onSelect={async (tab) => {
            setActiveTab(tab);
            if (tab === "profile") {
              // Placeholder sign-out path until a real profile screen exists.
              await AsyncStorage.removeItem("geoaid_resident_mobile");
              navigation.replace("Login");
            }
          }}
        />
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
  greeting: { fontSize: 13, color: "#6b7280" },
  householdName: { fontSize: 20, fontWeight: "700", color: "#0b1f3a" },
  bellBtn: { padding: 8 },
  bellBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    backgroundColor: "#dc2626",
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  bellBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  advisoryCard: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 12,
    padding: 12,
  },
  advisoryText: { flex: 1 },
  advisoryTitle: { fontWeight: "700", color: "#9a3412", marginBottom: 2 },
  advisoryBody: { fontSize: 12, color: "#7c2d12" },
  quickActions: { flexDirection: "row", gap: 10 },
  quickAction: { flex: 1, borderRadius: 12, padding: 12, alignItems: "center", gap: 6 },
  quickActionLabel: { fontSize: 11, fontWeight: "600", color: "#374151", textAlign: "center" },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  centerPanel: { backgroundColor: "#fff", borderRadius: 14, padding: 14, borderWidth: 1, borderColor: "#eef0f3" },
  centerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  centerName: { fontWeight: "700", fontSize: 15, color: "#0b1f3a" },
  centerMeta: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  statusPill: { backgroundColor: "#dcfce7", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { color: "#15803d", fontSize: 11, fontWeight: "700" },
  occupancyRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 14 },
  occupancyLabel: { fontSize: 12, color: "#6b7280" },
  occupancyBar: { height: 6, backgroundColor: "#eef0f3", borderRadius: 3, marginTop: 6, overflow: "hidden" },
  occupancyFill: { height: 6, backgroundColor: "#0b4a8f" },
  directionsBtn: {
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#0b4a8f",
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 14,
  },
  directionsBtnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  membersEmpty: { backgroundColor: "#fff", borderRadius: 12, padding: 16, borderWidth: 1, borderColor: "#eef0f3" },
  membersEmptyText: { fontSize: 13, color: "#6b7280", textAlign: "center" },
  membersList: { gap: 8 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: "#eef0f3",
  },
  memberAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "#e5e7eb" },
  memberInfo: { flex: 1 },
  memberName: { fontWeight: "600", fontSize: 14, color: "#111827" },
  memberRole: { fontSize: 12, color: "#6b7280" },
  memberFlags: { flexDirection: "row", flexWrap: "wrap", gap: 4, maxWidth: 100 },
  flagBadge: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
});

export default HomeScreen;
