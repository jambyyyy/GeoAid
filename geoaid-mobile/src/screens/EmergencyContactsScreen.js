import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, PhoneIcon } from "../components/icons";
import { API_BASE } from "../api";

function EmergencyContactsScreen({ navigation }) {
  const [contacts, setContacts] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchContacts = async () => {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      
      try {
        const response = await fetch(
          `${API_BASE}/api/resident/emergency-contacts/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setContacts(data.contacts || []);
        } else {
          // Fallback to default contacts if API fails
          setContacts(getDefaultContacts());
        }
      } catch (err) {
        console.error("Failed to fetch emergency contacts:", err);
        setContacts(getDefaultContacts());
      } finally {
        setLoading(false);
      }
    };

    fetchContacts();
  }, []);

  const getDefaultContacts = () => [
    { name: "Barangay Hall", phone: "N/A", type: "barangay" },
    { name: "Purok President", phone: "N/A", type: "purok" },
    { name: "Police Station", phone: "911", type: "emergency" },
    { name: "Fire Department", phone: "911", type: "emergency" },
    { name: "Hospital Emergency", phone: "911", type: "emergency" },
    { name: "CDRRMO", phone: "N/A", type: "government" },
  ];

  const handleCall = (phone) => {
    if (phone === "N/A") {
      Alert.alert("Contact Not Available", "This contact number is not available yet.");
      return;
    }
    
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Call Failed", "Unable to make phone call.");
    });
  };

  if (loading) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading emergency contacts…</Text>
        </View>
      </MobileShell>
    );
  }

  const getContactStyle = (type) => {
    switch (type) {
      case "emergency":
        return { backgroundColor: "#fee2e2", borderColor: "#fecaca" };
      case "barangay":
        return { backgroundColor: "#dbeafe", borderColor: "#bfdbfe" };
      case "purok":
        return { backgroundColor: "#fef3c7", borderColor: "#fde68a" };
      case "government":
        return { backgroundColor: "#e0e7ff", borderColor: "#c7d2fe" };
      default:
        return { backgroundColor: "#f3f4f6", borderColor: "#e5e7eb" };
    }
  };

  const getContactIconColor = (type) => {
    switch (type) {
      case "emergency":
        return "#dc2626";
      case "barangay":
        return "#2563eb";
      case "purok":
        return "#d97706";
      case "government":
        return "#4f46e5";
      default:
        return "#6b7280";
    }
  };

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
          <Text style={styles.title}>Emergency Contacts</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.infoCard}>
            <Text style={styles.infoTitle}>Important Numbers</Text>
            <Text style={styles.infoText}>
              Save these emergency contact numbers for quick access during disasters. 
              Tap any contact to call immediately.
            </Text>
          </View>

          <View style={styles.contactsList}>
            {contacts.map((contact, index) => (
              <TouchableOpacity
                key={index}
                style={[
                  styles.contactCard,
                  getContactStyle(contact.type)
                ]}
                onPress={() => handleCall(contact.phone)}
                accessibilityLabel={`Call ${contact.name}`}
              >
                <View style={styles.contactIcon}>
                  <PhoneIcon size={20} color={getContactIconColor(contact.type)} />
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.contactName}>{contact.name}</Text>
                  <Text style={styles.contactPhone}>{contact.phone}</Text>
                </View>
                <View style={styles.callIndicator}>
                  <Text style={styles.callText}>Call</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.emergencyNote}>
            <Text style={styles.emergencyNoteTitle}>Emergency Services</Text>
            <Text style={styles.emergencyNoteText}>
              For life-threatening emergencies, dial 911 immediately. 
              These contacts are for disaster-related assistance and coordination.
            </Text>
          </View>

          <View style={styles.updateNote}>
            <Text style={styles.updateNoteText}>
              Contact numbers are managed by your Barangay. Contact your Purok President if any information needs to be updated.
            </Text>
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
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: { padding: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  title: { fontSize: 17, fontWeight: "700", color: "#0f172a" },
  body: { paddingHorizontal: 20, paddingBottom: 24, gap: 18 },
  infoCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  infoTitle: { fontSize: 14, fontWeight: "700", color: "#9a3412", marginBottom: 4 },
  infoText: { fontSize: 13, color: "#7c2d12", lineHeight: 18 },
  contactsList: { gap: 10 },
  contactCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
  },
  contactIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  contactPhone: { fontSize: 13, color: "#64748b", marginTop: 2 },
  callIndicator: {
    backgroundColor: "#fff",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  callText: { fontSize: 12, fontWeight: "700", color: "#2563eb" },
  emergencyNote: {
    backgroundColor: "#fef2f2",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  emergencyNoteTitle: { fontSize: 13, fontWeight: "700", color: "#b91c1c", marginBottom: 4 },
  emergencyNoteText: { fontSize: 12, color: "#991b1b", lineHeight: 16 },
  updateNote: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  updateNoteText: { fontSize: 11, color: "#64748b", textAlign: "center", lineHeight: 15 },
});

export default EmergencyContactsScreen;