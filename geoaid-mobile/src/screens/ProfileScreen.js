import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, EditIcon, CheckIcon, XIcon } from "../components/icons";
import { API_BASE } from "../api";

function ProfileScreen({ navigation }) {
  const [householdData, setHouseholdData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    full_name: "",
    address_line: "",
    landmark: "",
    mobile_number: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const fetchProfile = async () => {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      
      try {
        const response = await fetch(
          `${API_BASE}/api/resident/profile/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setHouseholdData(data);
          setEditForm({
            full_name: data.full_name || "",
            address_line: data.address_line || "",
            landmark: data.landmark || "",
            mobile_number: data.mobile_number || mobileNumber,
          });
        }
      } catch (err) {
        console.error("Failed to fetch profile:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    
    try {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      const response = await fetch(`${API_BASE}/api/resident/profile/update/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile_number: mobileNumber,
          ...editForm,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        Alert.alert("Update Failed", data.message || "Could not update profile. Please try again.");
        return;
      }

      setHouseholdData(data);
      setEditing(false);
      Alert.alert("Success", "Profile updated successfully!");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Unable to connect to the server.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (householdData) {
      setEditForm({
        full_name: householdData.full_name || "",
        address_line: householdData.address_line || "",
        landmark: householdData.landmark || "",
        mobile_number: householdData.mobile_number || "",
      });
    }
    setEditing(false);
  };

  if (loading) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading profile…</Text>
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
          <Text style={styles.title}>My Profile</Text>
          {!editing && (
            <TouchableOpacity 
              style={styles.editBtn}
              onPress={() => setEditing(true)}
              accessibilityLabel="Edit Profile"
            >
              <EditIcon size={16} color="#2563eb" />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {householdData && (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Household Information</Text>
                
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Household Code</Text>
                    <Text style={styles.infoValue}>{householdData.household_code || "—"}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Barangay</Text>
                    <Text style={styles.infoValue}>{householdData.barangay || "—"}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Purok</Text>
                    <Text style={styles.infoValue}>{householdData.purok || "—"}</Text>
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Registration Status</Text>
                    <View style={[
                      styles.statusBadge,
                      householdData.status === "confirmed" && styles.statusConfirmed,
                      householdData.status === "approved" && styles.statusApproved,
                      householdData.status === "pending" && styles.statusPending,
                      householdData.status === "rejected" && styles.statusRejected,
                    ]}>
                      <Text style={styles.statusText}>
                        {householdData.status === "confirmed" ? "Confirmed" :
                         householdData.status === "approved" ? "Approved" :
                         householdData.status === "pending" ? "Pending" :
                         householdData.status === "rejected" ? "Rejected" : householdData.status}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Contact Information</Text>
                
                <View style={styles.infoCard}>
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Full Name</Text>
                    {editing ? (
                      <View style={styles.editField}>
                        <Text style={styles.editValue}>{editForm.full_name}</Text>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{householdData.full_name || "—"}</Text>
                    )}
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Mobile Number</Text>
                    {editing ? (
                      <View style={styles.editField}>
                        <Text style={styles.editValue}>{editForm.mobile_number}</Text>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{householdData.mobile_number || "—"}</Text>
                    )}
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Address</Text>
                    {editing ? (
                      <View style={styles.editField}>
                        <Text style={styles.editValue}>{editForm.address_line || "—"}</Text>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{householdData.address_line || "—"}</Text>
                    )}
                  </View>
                  
                  <View style={styles.infoRow}>
                    <Text style={styles.infoLabel}>Landmark</Text>
                    {editing ? (
                      <View style={styles.editField}>
                        <Text style={styles.editValue}>{editForm.landmark || "—"}</Text>
                      </View>
                    ) : (
                      <Text style={styles.infoValue}>{householdData.landmark || "—"}</Text>
                    )}
                  </View>
                </View>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Household Members ({householdData.members?.length || 0})</Text>
                
                {householdData.members && householdData.members.length > 0 ? (
                  <View style={styles.membersList}>
                    {householdData.members.map((member, index) => (
                      <View key={index} style={styles.memberCard}>
                        <View style={styles.memberAvatar} />
                        <View style={styles.memberInfo}>
                          <Text style={styles.memberName}>{member.full_name}</Text>
                          <Text style={styles.memberRole}>{member.relation}</Text>
                          <Text style={styles.memberAge}>Age: {member.age}</Text>
                        </View>
                        {member.flags && member.flags.length > 0 && (
                          <View style={styles.memberFlags}>
                            {member.flags.map((flag, flagIndex) => (
                              <View key={flagIndex} style={styles.flagBadge}>
                                <Text style={styles.flagText}>{flag}</Text>
                              </View>
                            ))}
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <View style={styles.emptyState}>
                    <Text style={styles.emptyText}>No household members added yet</Text>
                  </View>
                )}
              </View>

              {editing && (
                <View style={styles.editActions}>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.cancelBtn]}
                    onPress={handleCancel}
                    disabled={saving}
                  >
                    <XIcon color="#dc2626" />
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={[styles.actionBtn, styles.saveBtn]}
                    onPress={handleSave}
                    disabled={saving}
                  >
                    <CheckIcon color="#fff" />
                    <Text style={styles.saveBtnText}>{saving ? "Saving..." : "Save Changes"}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {!editing && householdData.status !== "confirmed" && (
                <View style={styles.infoNote}>
                  <Text style={styles.infoNoteText}>
                    Note: Profile changes may require re-verification by your Purok President.
                  </Text>
                </View>
              )}

              <TouchableOpacity 
                style={styles.purokContactBtn}
                onPress={() => navigation.navigate("PurokContact")}
              >
                <Text style={styles.purokContactBtnText}>Contact Purok President</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.logoutBtn}
                onPress={async () => {
                  await AsyncStorage.removeItem("geoaid_resident_mobile");
                  navigation.replace("Login");
                }}
              >
                <Text style={styles.logoutBtnText}>Log Out</Text>
              </TouchableOpacity>
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
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { padding: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  title: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  editBtn: { padding: 8, borderRadius: 8, backgroundColor: "#eaf3ff" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  infoCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    gap: 12,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  infoLabel: { fontSize: 13, color: "#64748b", fontWeight: "500" },
  infoValue: { fontSize: 14, fontWeight: "600", color: "#111827" },
  editField: {
    backgroundColor: "#f8fafc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 150,
  },
  editValue: { fontSize: 14, fontWeight: "600", color: "#111827" },
  statusBadge: {
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  statusConfirmed: { backgroundColor: "#dcfce7" },
  statusApproved: { backgroundColor: "#dbeafe" },
  statusPending: { backgroundColor: "#fef3c7" },
  statusRejected: { backgroundColor: "#fee2e2" },
  statusText: { fontSize: 12, fontWeight: "700", color: "#111827" },
  membersList: { gap: 8 },
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
  memberAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "#e5e7eb" },
  memberInfo: { flex: 1 },
  memberName: { fontWeight: "600", fontSize: 14, color: "#111827" },
  memberRole: { fontSize: 12, color: "#64748b" },
  memberAge: { fontSize: 11, color: "#9ca3af" },
  memberFlags: { flexDirection: "row", flexWrap: "wrap", gap: 4 },
  flagBadge: {
    backgroundColor: "#eaf3ff",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  flagText: { fontSize: 10, fontWeight: "700", color: "#2563eb" },
  emptyState: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    alignItems: "center",
  },
  emptyText: { fontSize: 13, color: "#64748b" },
  editActions: {
    flexDirection: "row",
    gap: 12,
    marginTop: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 8,
    paddingVertical: 12,
  },
  cancelBtn: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  cancelBtnText: { color: "#dc2626", fontWeight: "600", fontSize: 14 },
  saveBtn: {
    backgroundColor: "#2563eb",
  },
  saveBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  infoNote: {
    backgroundColor: "#fff7ed",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  infoNoteText: { fontSize: 12, color: "#9a3412", textAlign: "center" },
  purokContactBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  purokContactBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  logoutBtn: {
    backgroundColor: "#dc2626",
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  logoutBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

export default ProfileScreen;