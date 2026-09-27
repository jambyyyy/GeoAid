import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, CheckIcon, ClockIcon } from "../components/icons";
import { API_BASE } from "../api";

function ReliefDistributionScreen({ navigation }) {
  const [reliefData, setReliefData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReliefData = async () => {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      
      try {
        const response = await fetch(
          `${API_BASE}/api/resident/relief-distribution/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setReliefData(data);
        }
      } catch (err) {
        console.error("Failed to fetch relief distribution data:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchReliefData();
  }, []);

  if (loading) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading relief distribution status…</Text>
        </View>
      </MobileShell>
    );
  }

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity 
            style={styles.backBtn} 
            onPress={() => navigation.goBack()} 
            accessibilityLabel="Back"
          >
            <BackIcon />
          </TouchableOpacity>
          <Text style={styles.title}>Relief Distribution</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {reliefData ? (
            <>
              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>Current Status</Text>
                <View style={[
                  styles.statusBadge,
                  reliefData.status === "received" && styles.statusReceived,
                  reliefData.status === "pending" && styles.statusPending,
                  reliefData.status === "not_eligible" && styles.statusNotEligible,
                ]}>
                  <Text style={styles.statusText}>
                    {reliefData.status === "received" ? "Relief Received" :
                     reliefData.status === "pending" ? "Pending Distribution" :
                     reliefData.status === "not_eligible" ? "Not Yet Eligible" : "Unknown"}
                  </Text>
                </View>
                <Text style={styles.statusDescription}>
                  {reliefData.status === "received" ? "Your household has received relief goods." :
                   reliefData.status === "pending" ? "Your relief is being prepared for distribution." :
                   reliefData.status === "not_eligible" ? "Complete your household registration to become eligible for relief distribution." : ""}
                </Text>
              </View>

              {reliefData.last_distribution && (
                <View style={styles.section}>
                  <Text style={styles.sectionLabel}>Last Distribution</Text>
                  <View style={styles.distributionCard}>
                    <View style={styles.distributionHeader}>
                      <View style={styles.distributionIcon}>
                        <CheckIcon color="#15803d" />
                      </View>
                      <View style={styles.distributionInfo}>
                        <Text style={styles.distributionTitle}>Relief Package Received</Text>
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
                            item.status === "pending" && styles.historyPending,
                          ]}>
                            <Text style={styles.historyStatusText}>
                              {item.status === "claimed" ? "Claimed" : "Pending"}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.historyDetails}>
                          <Text style={styles.historyGoods}>{item.goods_type} x{item.quantity}</Text>
                          {item.remarks && (
                            <Text style={styles.historyRemarks}>{item.remarks}</Text>
                          )}
                        </View>
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
                  Relief distribution is based on your household's vulnerability priority and registration status. Contact your Purok President for more information.
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Unable to load relief distribution data</Text>
            </View>
          )}
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
  historyPending: { backgroundColor: "#fef3c7" },
  historyStatusText: { fontSize: 11, fontWeight: "700", color: "#111827" },
  historyDetails: {},
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
});

export default ReliefDistributionScreen;