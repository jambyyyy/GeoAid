import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, CheckIcon, ClockIcon, XIcon } from "../components/icons";
import { API_BASE } from "../api";
import Svg, { Circle, Path } from "react-native-svg";

const STATUS_STEPS = [
  { key: "pending", label: "Pending Review", description: "Waiting for Purok President review" },
  { key: "approved", label: "Purok Approved", description: "Approved by Purok President" },
  { key: "confirmed", label: "Confirmed", description: "Confirmed by Barangay Staff" },
  { key: "rejected", label: "Rejected", description: "Registration needs correction" },
];

function RegistrationStatusScreen({ navigation }) {
  const [status, setStatus] = useState("pending");
  const [householdData, setHouseholdData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStatus = async () => {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      
      try {
        const response = await fetch(
          `${API_BASE}/api/resident/registration-status/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setStatus(data.status || "pending");
          setHouseholdData(data.household || null);
        }
      } catch (err) {
        console.error("Failed to fetch registration status:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, []);

  const getStatusStepIndex = () => {
    if (status === "rejected") return -1;
    if (status === "pending") return 0;
    if (status === "approved") return 1;
    if (status === "confirmed") return 2;
    return 0;
  };

  const currentStepIndex = getStatusStepIndex();

  if (loading) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading registration status…</Text>
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
          <Text style={styles.title}>Registration Status</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {status === "rejected" ? (
            <View style={styles.rejectedCard}>
              <XIcon color="#dc2626" />
              <Text style={styles.rejectedTitle}>Registration Rejected</Text>
              <Text style={styles.rejectedText}>
                Your household registration was rejected. Please contact your Purok President for more information or register again with corrected information.
              </Text>
              <TouchableOpacity
                style={styles.reregisterBtn}
                onPress={() => navigation.navigate("Register")}
              >
                <Text style={styles.reregisterBtnText}>Register Again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.statusCard}>
                <Text style={styles.statusLabel}>Current Status</Text>
                <View style={styles.statusBadge}>
                  <Text style={styles.statusText}>
                    {STATUS_STEPS.find(s => s.key === status)?.label || "Unknown"}
                  </Text>
                </View>
                <Text style={styles.statusDescription}>
                  {STATUS_STEPS.find(s => s.key === status)?.description || ""}
                </Text>
              </View>

              <View style={styles.progressSection}>
                <Text style={styles.progressLabel}>Approval Progress</Text>
                <View style={styles.progressContainer}>
                  {STATUS_STEPS.filter(s => s.key !== "rejected").map((step, index) => {
                    const isCompleted = index < currentStepIndex;
                    const isCurrent = index === currentStepIndex;
                    const isPending = index > currentStepIndex;

                    return (
                      <View key={step.key} style={styles.progressStep}>
                        <View style={styles.stepRow}>
                          <View style={[
                            styles.stepIcon,
                            isCompleted && styles.stepIconCompleted,
                            isCurrent && styles.stepIconCurrent,
                            isPending && styles.stepIconPending
                          ]}>
                            {isCompleted ? (
                              <CheckIcon color="#fff" />
                            ) : isCurrent ? (
                              <ClockIcon color="#2563eb" />
                            ) : (
                              <Text style={styles.stepNumber}>{index + 1}</Text>
                            )}
                          </View>
                          <View style={styles.stepContent}>
                            <Text style={[
                              styles.stepLabel,
                              isCompleted && styles.stepLabelCompleted,
                              isCurrent && styles.stepLabelCurrent,
                              isPending && styles.stepLabelPending
                            ]}>
                              {step.label}
                            </Text>
                            <Text style={styles.stepDescription}>{step.description}</Text>
                          </View>
                        </View>
                        {index < STATUS_STEPS.filter(s => s.key !== "rejected").length - 1 && (
                          <View style={[
                            styles.stepConnector,
                            isCompleted && styles.stepConnectorCompleted
                          ]} />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {householdData && (
                <View style={styles.householdInfo}>
                  <Text style={styles.infoLabel}>Household Information</Text>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabelSmall}>Household Code:</Text>
                    <Text style={styles.infoValue}>{householdData.household_code || "—"}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabelSmall}>Barangay:</Text>
                    <Text style={styles.infoValue}>{householdData.barangay || "—"}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabelSmall}>Purok:</Text>
                    <Text style={styles.infoValue}>{householdData.purok || "—"}</Text>
                  </View>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabelSmall}>Submitted:</Text>
                    <Text style={styles.infoValue}>{householdData.submitted || "—"}</Text>
                  </View>
                </View>
              )}

              {status === "confirmed" && (
                <View style={styles.successCard}>
                  <CheckIcon color="#15803d" />
                  <Text style={styles.successTitle}>Registration Complete!</Text>
                  <Text style={styles.successText}>
                    Your household registration is confirmed. You can now access all GeoAid features including QR codes for evacuation check-in and relief distribution tracking.
                  </Text>
                  <TouchableOpacity
                    style={styles.continueBtn}
                    onPress={() => navigation.navigate("Home")}
                  >
                    <Text style={styles.continueBtnText}>Continue to Home</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
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
  rejectedCard: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  rejectedTitle: { fontSize: 16, fontWeight: "700", color: "#dc2626" },
  rejectedText: { fontSize: 13, color: "#991b1b", textAlign: "center", lineHeight: 18 },
  reregisterBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  reregisterBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
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
    backgroundColor: "#dbeafe",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusText: { color: "#1d4ed8", fontWeight: "700", fontSize: 14 },
  statusDescription: { fontSize: 13, color: "#64748b", textAlign: "center" },
  progressSection: {},
  progressLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 12 },
  progressContainer: { gap: 4 },
  progressStep: {},
  stepRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  stepIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  stepIconCompleted: { backgroundColor: "#15803d", borderColor: "#15803d" },
  stepIconCurrent: { backgroundColor: "#fff", borderColor: "#2563eb" },
  stepIconPending: { backgroundColor: "#e5e7eb", borderColor: "#d1d5db" },
  stepNumber: { fontSize: 12, fontWeight: "700", color: "#6b7280" },
  stepContent: { flex: 1, paddingTop: 2 },
  stepLabel: { fontSize: 14, fontWeight: "600", color: "#374151" },
  stepLabelCompleted: { color: "#15803d" },
  stepLabelCurrent: { color: "#2563eb" },
  stepLabelPending: { color: "#9ca3af" },
  stepDescription: { fontSize: 12, color: "#64748b", marginTop: 2 },
  stepConnector: {
    marginLeft: 13,
    height: 20,
    width: 2,
    backgroundColor: "#e5e7eb",
  },
  stepConnectorCompleted: { backgroundColor: "#15803d" },
  householdInfo: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    gap: 10,
  },
  infoLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 4 },
  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabelSmall: { fontSize: 12, color: "#64748b" },
  infoValue: { fontSize: 12, fontWeight: "600", color: "#111827" },
  successCard: {
    backgroundColor: "#f0fdf4",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: 12,
    padding: 16,
    alignItems: "center",
    gap: 12,
  },
  successTitle: { fontSize: 16, fontWeight: "700", color: "#15803d" },
  successText: { fontSize: 13, color: "#166534", textAlign: "center", lineHeight: 18 },
  continueBtn: {
    backgroundColor: "#15803d",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    marginTop: 8,
  },
  continueBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
});

export default RegistrationStatusScreen;