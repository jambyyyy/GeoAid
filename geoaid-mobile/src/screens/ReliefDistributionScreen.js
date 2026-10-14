import { mergeResidentStyles } from "../residentPolish";
import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, RefreshControl, Alert, ActivityIndicator, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, CheckIcon, ClockIcon } from "../components/icons";
import { API_BASE } from "../api";

function ReliefDistributionScreen({ navigation }) {
  const [reliefData, setReliefData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [confirmingId, setConfirmingId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");

  const fetchReliefData = async () => {
    const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");

    if (!mobileNumber) {
      setLoadError("Please sign in to view your household's relief records.");
      setLoading(false);
      return;
    }

    try {
      setLoadError("");
      const response = await fetch(
        `${API_BASE}/api/resident/relief-distribution/?mobile_number=${encodeURIComponent(mobileNumber)}`
      );

      if (response.ok) {
        const data = await response.json();
        setReliefData(data);
      } else {
        setLoadError("Relief records could not be loaded. Please try again.");
      }
    } catch (err) {
      console.error("Failed to fetch relief distribution data:", err);
      setLoadError("Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReliefData();
  }, []);

  const refreshRelief = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await fetchReliefData();
    } finally {
      setRefreshing(false);
    }
  };

  // Alert.alert's buttons don't work on react-native-web, so use
  // window.confirm / window.alert there and Alert on iOS/Android.
  const notify = (title, message) => {
    if (Platform.OS === "web") {
      window.alert(`${title}\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  const submitConfirm = async (item) => {
    setConfirmingId(item.id);
    try {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      const response = await fetch(`${API_BASE}/api/resident/relief-distribution/confirm/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mobile_number: mobileNumber, id: item.id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        notify("Could not confirm", data.message || "Please try again.");
        return;
      }

      await fetchReliefData();
      notify("Thank you!", data.message || "Receipt confirmed.");
    } catch (err) {
      console.error(err);
      notify("Could not confirm", "Unable to connect to the server.");
    } finally {
      setConfirmingId(null);
    }
  };

  // Resident confirms their household received this relief.
  const confirmReceived = (item) => {
    const question = `Did your household receive ${item.goods_type} x${item.quantity}?`;

    if (Platform.OS === "web") {
      if (window.confirm(`Confirm receipt\n${question}`)) {
        submitConfirm(item);
      }
      return;
    }

    Alert.alert("Confirm receipt", question, [
      { text: "Not yet", style: "cancel" },
      { text: "Yes, I received it", onPress: () => submitConfirm(item) },
    ]);
  };

  const STATUS_LABEL = {
    received: "Relief Received",
    ready: "Ready for Pickup",
    processing: "Being Processed",
    pending: "Pending Distribution",
    not_eligible: "Not Yet Eligible",
  };
  const STATUS_DESC = {
    received: "Your household has received relief goods.",
    ready: "Your relief is ready. Once you receive it, tap Confirm Received below.",
    processing: "CSWD is preparing your relief goods. You can confirm receipt once it is Ready for Pickup.",
    pending: "Waiting for relief to be allocated to your household.",
    not_eligible: "Your household registration must be confirmed before relief can be allocated.",
  };
  const NEXT_ACTION = {
    received: "Already received. No confirmation is needed for this completed record.",
    ready: "Collect the allocated goods from Barangay staff. Tap Confirm Received only AFTER the goods are physically handed to you.",
    processing: "Barangay staff are preparing your allocation. You do not need to confirm anything yet.",
    pending: "There is no active allocation yet. Check back for updates from your Barangay.",
    not_eligible: "Check your registration status before expecting an allocation.",
  };
  const currentStage = reliefData?.status === "received" ? 3
    : reliefData?.status === "ready" ? 2
    : reliefData?.status === "processing" ? 1 : 0;
  const HISTORY_LABEL = {
    claimed: "Received",
    ready: "Ready for Pickup",
    processing: "Processing",
    pending: "Processing",
  };

  if (loading) {
    return (
      <MobileShell>
        <SafeAreaView style={styles.loading} edges={["top", "bottom"]}>
          <Text>Loading relief distribution status…</Text>
        </SafeAreaView>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backBtn} 
            onPress={() => navigation.goBack()} 
            accessibilityLabel="Back"
          >
            <BackIcon />
          </TouchableOpacity>
          <Text style={styles.title}>Relief Distribution</Text>
          <TouchableOpacity onPress={refreshRelief} style={styles.refreshButton}
            disabled={refreshing} accessibilityRole="button" accessibilityLabel="Refresh relief status">
            {refreshing ? <ActivityIndicator color="#2563eb" size="small" /> : <Text style={styles.refreshText}>Refresh</Text>}
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.body} refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refreshRelief} tintColor="#2563eb" />
        }>
          {reliefData ? (
            <>
              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>Current Status</Text>
                <View style={[
                  styles.statusBadge,
                  reliefData.status === "received" && styles.statusReceived,
                  reliefData.status === "ready" && styles.statusReady,
                  (reliefData.status === "pending" || reliefData.status === "processing") && styles.statusPending,
                  reliefData.status === "not_eligible" && styles.statusNotEligible,
                ]}>
                  <Text style={styles.statusText}>
                    {STATUS_LABEL[reliefData.status] || "Unknown"}
                  </Text>
                </View>
                <Text style={styles.statusDescription}>
                  {STATUS_DESC[reliefData.status] || ""}
                </Text>
                <View style={styles.nextAction}>
                  <Text style={styles.nextActionTitle}>What should I do?</Text>
                  <Text style={styles.nextActionText}>{NEXT_ACTION[reliefData.status] || "Ask your Barangay for an update."}</Text>
                </View>
              </View>

              {reliefData.status !== "not_eligible" && (
                <View style={styles.progressCard}>
                  <Text style={styles.sectionLabel}>Relief progress</Text>
                  <View style={styles.progressRow}>
                    {["Processing", "Ready for Pickup", "Received"].map((name, index) => (
                      <View key={name} style={styles.progressItem}>
                        <View style={[styles.progressDot, currentStage > index && styles.progressDotDone]}>
                          <Text style={[styles.progressNumber, currentStage > index && styles.progressNumberDone]}>
                            {currentStage > index ? "✓" : index + 1}
                          </Text>
                        </View>
                        <Text style={styles.progressLabel}>{name}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {reliefData.last_distribution && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Last Distribution</Text>
                  <View style={styles.distributionCard}>
                    <View style={styles.distributionHeader}>
                      <View style={styles.distributionIcon}>
                        <CheckIcon color="#15803d" />
                      </View>
                      <View style={styles.distributionInfo}>
                        <Text style={styles.distributionTitle}>Latest Relief Allocation</Text>
                        <Text style={styles.distributionDate}>{reliefData.last_distribution.date}</Text>
                      </View>
                    </View>
                    
                    <View style={styles.distributionDetails}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Goods Type</Text>
                        <Text style={styles.detailValue}>{reliefData.last_distribution.goods_type}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Quantity</Text>
                        <Text style={styles.detailValue}>{reliefData.last_distribution.quantity}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Distributed By</Text>
                        <Text style={styles.detailValue}>{reliefData.last_distribution.distributed_by || "—"}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Tracking Number</Text>
                        <Text style={styles.detailValue}>{reliefData.last_distribution.tracking_number || "—"}</Text>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              {reliefData.distribution_history && reliefData.distribution_history.length > 0 && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Distribution History ({reliefData.distribution_history.length})</Text>
                  <View style={styles.historyList}>
                    {reliefData.distribution_history.map((item, index) => (
                      <View key={index} style={styles.historyItem}>
                        <View style={styles.historyHeader}>
                          <Text style={styles.historyDate}>{item.date}</Text>
                          <View style={[
                            styles.historyStatus,
                            item.status === "claimed" && styles.historyClaimed,
                            item.status === "ready" && styles.historyReady,
                            (item.status === "processing" || item.status === "pending") && styles.historyPending,
                          ]}>
                            <Text style={styles.historyStatusText}>
                              {HISTORY_LABEL[item.status] || item.status}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.historyDetails}>
                          <Text style={styles.historyGoods}>{item.goods_type} x{item.quantity}</Text>
                          {item.remarks ? (
                            <Text style={styles.historyRemarks}>{item.remarks}</Text>
                          ) : null}
                          {item.status === "claimed" && item.claimed_at ? (
                            <Text style={styles.historyRemarks}>Received {item.claimed_at}</Text>
                          ) : null}
                        </View>
                        {item.status === "ready" && (
                          <TouchableOpacity
                            style={styles.confirmBtn}
                            onPress={() => confirmReceived(item)}
                            disabled={confirmingId === item.id}
                          >
                            {confirmingId === item.id ? (
                              <ActivityIndicator color="#fff" />
                            ) : (
                              <Text style={styles.confirmBtnText}>I Have Received These Goods</Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {(!reliefData.distribution_history || reliefData.distribution_history.length === 0) && (
                <View style={styles.emptyState}>
                  <ClockIcon color="#9ca3af" />
                  <Text style={styles.emptyText}>No relief distribution history yet</Text>
                  <Text style={styles.emptySubtext}>
                    You will be notified when relief goods are allocated to your household.
                  </Text>
                </View>
              )}

              <View style={styles.infoNote}>
                <Text style={styles.infoNoteText}>
                  Relief is allocated by Barangay staff based on eligibility and need. For pending allocations, contact your Barangay or Purok representative.
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Unable to load relief distribution data</Text>
              <Text style={styles.emptySubtext}>{loadError || "Check your connection and try again."}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={refreshRelief} disabled={refreshing}>
                <Text style={styles.retryText}>Try Again</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </MobileShell>
  );
}

const styles = StyleSheet.create(mergeResidentStyles({
  refreshButton: { minWidth: 70, minHeight: 42, backgroundColor: "#eff6ff",
    borderRadius: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  refreshText: { color: "#1d4ed8", fontWeight: "700", fontSize: 13 },
  nextAction: { backgroundColor: "#eff6ff", borderRadius: 10, padding: 12, gap: 4 },
  nextActionTitle: { fontSize: 14, color: "#1e40af", fontWeight: "700" },
  nextActionText: { fontSize: 14, color: "#1e3a8a", lineHeight: 21 },
  progressCard: { borderWidth: 1, borderColor: "#e2e8f0", borderRadius: 14,
    backgroundColor: "#fff", padding: 14 },
  progressRow: { flexDirection: "row", gap: 8, marginTop: 10 },
  progressItem: { flex: 1, alignItems: "center", gap: 6, minWidth: 0 },
  progressDot: { width: 30, height: 30, borderRadius: 15, borderWidth: 2,
    borderColor: "#cbd5e1", alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  progressDotDone: { backgroundColor: "#15803d", borderColor: "#15803d" },
  progressNumber: { color: "#64748b", fontSize: 13, fontWeight: "700" },
  progressNumberDone: { color: "#fff" },
  progressLabel: { fontSize: 12, color: "#526176", textAlign: "center", lineHeight: 17 },
  retryButton: { marginTop: 6, paddingHorizontal: 24, minHeight: 46, borderRadius: 10,
    backgroundColor: "#2563eb", justifyContent: "center", alignItems: "center" },
  retryText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  screen: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { padding: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  title: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  statusCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    alignItems: "center",
    gap: 8,
  },
  statusLabel: { fontSize: 12, color: "#64748b", fontWeight: "600" },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusReceived: { backgroundColor: "#dcfce7" },
  statusReady: { backgroundColor: "#dbeafe" },
  statusPending: { backgroundColor: "#fef3c7" },
  statusNotEligible: { backgroundColor: "#fee2e2" },
  statusText: { color: "#111827", fontWeight: "700", fontSize: 14 },
  statusDescription: { fontSize: 13, color: "#64748b", textAlign: "center" },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  distributionCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    gap: 12,
  },
  distributionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  distributionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#dcfce7",
    alignItems: "center",
    justifyContent: "center",
  },
  distributionInfo: { flex: 1 },
  distributionTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  distributionDate: { fontSize: 12, color: "#64748b", marginTop: 2 },
  distributionDetails: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  detailLabel: { fontSize: 12, color: "#64748b" },
  detailValue: { fontSize: 12, fontWeight: "600", color: "#111827" },
  historyList: { gap: 8 },
  historyItem: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eef0f3",
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  historyDate: { fontSize: 12, fontWeight: "600", color: "#111827" },
  historyStatus: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  historyClaimed: { backgroundColor: "#dcfce7" },
  historyReady: { backgroundColor: "#dbeafe" },
  historyPending: { backgroundColor: "#fef3c7" },
  historyStatusText: { fontSize: 11, fontWeight: "700", color: "#111827" },
  historyDetails: {},
  confirmBtn: {
    marginTop: 10,
    backgroundColor: "#15803d",
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  confirmBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  historyGoods: { fontSize: 13, fontWeight: "600", color: "#111827" },
  historyRemarks: { fontSize: 11, color: "#64748b", marginTop: 4 },
  emptyState: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 24,
    borderWidth: 1,
    borderColor: "#eef0f3",
    alignItems: "center",
    gap: 8,
  },
  emptyText: { fontSize: 14, fontWeight: "600", color: "#64748b" },
  emptySubtext: { fontSize: 12, color: "#9ca3af", textAlign: "center" },
  infoNote: {
    backgroundColor: "#fff7ed",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  infoNoteText: { fontSize: 12, color: "#9a3412", textAlign: "center", lineHeight: 16 },
}, "relief"));

export default ReliefDistributionScreen;
