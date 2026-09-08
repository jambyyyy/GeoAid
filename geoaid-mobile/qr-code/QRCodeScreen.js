import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
// NOTE: paths below assume geoaid-mobile/src/components/... and
// geoaid-mobile/src/api.js — since this file lives in qr-code/ (a sibling
// of src/), adjust these three import paths if your src/ layout differs.
import MobileShell from "../src/components/MobileShell";
import { BackIcon, ShieldIcon } from "../src/components/icons";
import { API_BASE } from "../src/api";
import QRCode from "./QRCode";

// Same dashboard payload HomeScreen uses, extended with the fields this
// screen needs. See the note above tokenFor() for what the backend must add.
const FALLBACK_DATA = {
  household_id: "demo-household",
  household_name: "Santos Household",
  members: [
    { id: 1, name: "Maria Santos", role: "Head of Household", qr_token: "demo-household:1" },
    { id: 2, name: "Juan Santos", role: "Spouse", qr_token: "demo-household:2" },
    { id: 3, name: "Ana Santos", role: "Child", qr_token: "demo-household:3" },
  ],
};

function QRCodeScreen({ navigation }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = async () => {
    const mobileNumber = (await AsyncStorage.getItem("geoaid_resident_mobile")) || "";

    try {
      const response = await fetch(
        `${API_BASE}/api/resident/dashboard/?mobile_number=${encodeURIComponent(mobileNumber)}`
      );
      if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
      const json = await response.json();
      setData(json);
      setError("");
    } catch (err) {
      console.warn("Falling back to mock QR data:", err.message);
      setData(FALLBACK_DATA);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!data) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading QR codes…</Text>
        </View>
      </MobileShell>
    );
  }

  const { household_id: householdId, household_name: householdName, members = [] } = data;

  // Each QR code should encode an opaque, stable identifier — never raw
  // name/mobile number, since that data would be readable by anyone who
  // scans or photographs the code. Prefer a server-issued qr_token
  // (ideally a signed/rotatable token the backend can revoke). Falling
  // back to "householdId:memberId" only works once those fields exist on
  // the dashboard response — ask backend to add them if you see
  // "No code yet" below.
  const tokenFor = (member) =>
    member.qr_token || (householdId && member.id != null ? `${householdId}:${member.id}` : null);

  const headMember =
    members.find((m) => m.role === "Head" || m.role === "Head of Household") || members[0];
  const selectedMember = members.find((m) => (m.id ?? m.name) === selectedId) || headMember;
  const selectedToken = selectedMember ? tokenFor(selectedMember) : null;

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} accessibilityLabel="Back">
            <BackIcon />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>My QR Code</Text>
            <Text style={styles.subtitle}>Show at evacuation center check-in</Text>
          </View>
        </View>

        <ScrollView
          contentContainerStyle={styles.body}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {selectedMember && selectedToken && (
            <View style={styles.featuredCard}>
              <Text style={styles.featuredLabel}>
                {selectedMember === headMember ? "Your Code" : "Selected Member"}
              </Text>
              <QRCode value={selectedToken} size={200} />
              <Text style={styles.featuredName}>{selectedMember.name}</Text>
              <Text style={styles.featuredRole}>{selectedMember.role}</Text>
              <View style={styles.hintRow}>
                <ShieldIcon size={14} color="#6b7280" />
                <Text style={styles.hintText}>
                  Responders scan this to check {selectedMember === headMember ? "you" : selectedMember.name.split(" ")[0]} in and log arrivals for {householdName}.
                </Text>
              </View>
            </View>
          )}

          <Text style={styles.sectionLabel}>All Household Members ({members.length})</Text>
          <View style={styles.list}>
            {members.map((m, i) => {
              const token = tokenFor(m);
              const rowId = m.id ?? m.name;
              const isSelected = selectedMember && (selectedMember.id ?? selectedMember.name) === rowId;
              return (
                <TouchableOpacity
                  key={rowId ?? i}
                  style={[styles.memberCard, isSelected && styles.memberCardSelected]}
                  onPress={() => setSelectedId(rowId)}
                  disabled={!token}
                  activeOpacity={0.7}
                >
                  {token ? (
                    <QRCode value={token} size={64} />
                  ) : (
                    <View style={styles.qrPlaceholder}>
                      <Text style={styles.qrPlaceholderText}>No code yet</Text>
                    </View>
                  )}
                  <View style={styles.memberInfo}>
                    <Text style={styles.memberName}>{m.name}</Text>
                    <Text style={styles.memberRole}>{m.role}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.footerNote}>
            Each family member has their own code. Bring a screenshot or this screen with you — it
            works even without a signal once loaded.
          </Text>
        </ScrollView>
      </View>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { padding: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  title: { fontSize: 17, fontWeight: "700", color: "#0b1f3a" },
  subtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  body: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32, gap: 18 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10 },
  errorText: { color: "#b42318", fontSize: 13 },
  featuredCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    paddingVertical: 20,
    alignItems: "center",
    gap: 6,
  },
  featuredLabel: { fontSize: 12, fontWeight: "700", color: "#0b4a8f", textTransform: "uppercase", letterSpacing: 0.5 },
  featuredName: { fontSize: 16, fontWeight: "700", color: "#0b1f3a", marginTop: 8 },
  featuredRole: { fontSize: 12, color: "#6b7280" },
  hintRow: { flexDirection: "row", gap: 6, alignItems: "flex-start", marginTop: 10, paddingHorizontal: 20 },
  hintText: { flex: 1, fontSize: 11, color: "#6b7280", lineHeight: 15 },
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151" },
  list: { gap: 10 },
  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef0f3",
  },
  memberCardSelected: {
    borderColor: "#0b4a8f",
    backgroundColor: "#eaf3ff",
  },
  qrPlaceholder: {
    width: 64 + 24,
    height: 64 + 24,
    borderRadius: 12,
    backgroundColor: "#f5f7fa",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  qrPlaceholderText: { fontSize: 10, color: "#9aa3af", textAlign: "center", paddingHorizontal: 6 },
  memberInfo: { flex: 1 },
  memberName: { fontWeight: "600", fontSize: 14, color: "#111827" },
  memberRole: { fontSize: 12, color: "#6b7280" },
  footerNote: { fontSize: 11, color: "#9aa3af", textAlign: "center", lineHeight: 16 },
});

export default QRCodeScreen;