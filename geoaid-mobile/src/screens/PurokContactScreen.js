import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, TextInput } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import { BackIcon, PhoneIcon, SendIcon } from "../components/icons";
import { API_BASE } from "../api";

function PurokContactScreen({ navigation }) {
  const [purokInfo, setPurokInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const fetchPurokInfo = async () => {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      
      try {
        const response = await fetch(
          `${API_BASE}/api/resident/purok-info/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        
        if (response.ok) {
          const data = await response.json();
          setPurokInfo(data);
        } else {
          // Fallback data if API fails
          setPurokInfo({
            purok_name: "Your Purok",
            purok_president: "Purok President",
            contact_number: "N/A",
            barangay: "Your Barangay",
          });
        }
      } catch (err) {
        console.error("Failed to fetch purok info:", err);
        setPurokInfo({
          purok_name: "Your Purok",
          purok_president: "Purok President",
          contact_number: "N/A",
          barangay: "Your Barangay",
        });
      } finally {
        setLoading(false);
      }
    };

    fetchPurokInfo();
  }, []);

  const handleCall = () => {
    if (!purokInfo?.contact_number || purokInfo.contact_number === "N/A") {
      Alert.alert("Contact Not Available", "Your Purok President's contact number is not available yet.");
      return;
    }
    
    // Use Linking to make phone call
    // Note: In a real app, you'd use Linking.openURL(`tel:${purokInfo.contact_number}`)
    Alert.alert("Call Purok President", `Would you like to call ${purokInfo.purok_president} at ${purokInfo.contact_number}?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Call", onPress: () => console.log("Calling:", purokInfo.contact_number) },
    ]);
  };

  const handleSendMessage = async () => {
    if (!message.trim()) {
      Alert.alert("Empty Message", "Please enter a message before sending.");
      return;
    }

    setSending(true);
    
    try {
      const mobileNumber = await AsyncStorage.getItem("geoaid_resident_mobile");
      const response = await fetch(`${API_BASE}/api/resident/contact-purok/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile_number: mobileNumber,
          message: message.trim(),
        }),
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        Alert.alert("Message Failed", result.message || "Unable to send message. Please try again.");
        return;
      }

      setMessage("");
      Alert.alert("Message Sent", "Your message has been sent to your Purok President. They will respond as soon as possible.");
    } catch (err) {
      console.error(err);
      Alert.alert("Error", "Unable to connect to the server.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <MobileShell>
        <View style={styles.loading}>
          <Text>Loading purok information…</Text>
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
          <Text style={styles.title}>Contact Purok President</Text>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          {purokInfo && (
            <>
              <View style={styles.purokCard}>
                <View style={styles.purokHeader}>
                  <View style={styles.purokAvatar}>
                    <Text style={styles.purokAvatarText}>
                      {purokInfo.purok_president?.charAt(0) || "P"}
                    </Text>
                  </View>
                  <View style={styles.purokInfo}>
                    <Text style={styles.purokName}>{purokInfo.purok_president}</Text>
                    <Text style={styles.purokRole}>Purok President</Text>
                    <Text style={styles.purokLocation}>{purokInfo.purok_name}, {purokInfo.barangay}</Text>
                  </View>
                </View>

                <TouchableOpacity 
                  style={styles.callBtn}
                  onPress={handleCall}
                  accessibilityLabel="Call Purok President"
                >
                  <PhoneIcon color="#fff" />
                  <Text style={styles.callBtnText}>Call {purokInfo.contact_number !== "N/A" ? purokInfo.contact_number : "Contact"}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Send Message</Text>
                <View style={styles.messageCard}>
                  <TextInput
                    style={styles.messageInput}
                    placeholder="Type your message here..."
                    placeholderTextColor="#9ca3af"
                    value={message}
                    onChangeText={setMessage}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                  <TouchableOpacity 
                    style={[styles.sendBtn, !message.trim() && styles.sendBtnDisabled]}
                    onPress={handleSendMessage}
                    disabled={!message.trim() || sending}
                  >
                    <SendIcon color={message.trim() ? "#fff" : "#9ca3af"} />
                    <Text style={[styles.sendBtnText, !message.trim() && styles.sendBtnTextDisabled]}>
                      {sending ? "Sending..." : "Send"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Verification Support</Text>
                <Text style={styles.infoText}>
                  Contact your Purok President if you have questions about your household registration, 
                  need help with verification, or have concerns about your registration status.
                </Text>
              </View>

              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Response Time</Text>
                <Text style={styles.infoText}>
                  Your Purok President typically responds within 24-48 hours. For urgent matters during 
                  active disasters, please use the emergency contacts or visit your barangay hall directly.
                </Text>
              </View>

              <View style={styles.guidelinesCard}>
                <Text style={styles.guidelinesTitle}>Messaging Guidelines</Text>
                <View style={styles.guidelinesList}>
                  <View style={styles.guidelineItem}>
                    <Text style={styles.guidelineText}>• Be clear and specific about your concern</Text>
                  </View>
                  <View style={styles.guidelineItem}>
                    <Text style={styles.guidelineText}>• Include your household code for faster assistance</Text>
                  </View>
                  <View style={styles.guidelineItem}>
                    <Text style={styles.guidelineText}>• Keep messages professional and respectful</Text>
                  </View>
                  <View style={styles.guidelineItem}>
                    <Text style={styles.guidelineText}>• Use this for registration-related matters only</Text>
                  </View>
                </View>
              </View>
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
  purokCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    gap: 12,
  },
  purokHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  purokAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#dbeafe",
    alignItems: "center",
    justifyContent: "center",
  },
  purokAvatarText: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1d4ed8",
  },
  purokInfo: { flex: 1 },
  purokName: { fontSize: 16, fontWeight: "700", color: "#111827" },
  purokRole: { fontSize: 13, color: "#64748b", marginTop: 2 },
  purokLocation: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  callBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 12,
  },
  callBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  section: {},
  sectionLabel: { fontSize: 13, fontWeight: "700", color: "#374151", marginBottom: 8 },
  messageCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#eef0f3",
    gap: 12,
  },
  messageInput: {
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: "#111827",
    minHeight: 100,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    borderRadius: 8,
    paddingVertical: 12,
  },
  sendBtnDisabled: {
    backgroundColor: "#e5e7eb",
  },
  sendBtnText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  sendBtnTextDisabled: { color: "#9ca3af" },
  infoCard: {
    backgroundColor: "#f0fdf4",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#bbf7d0",
  },
  infoTitle: { fontSize: 13, fontWeight: "700", color: "#166534", marginBottom: 4 },
  infoText: { fontSize: 12, color: "#15803d", lineHeight: 16 },
  guidelinesCard: {
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "#fed7aa",
  },
  guidelinesTitle: { fontSize: 13, fontWeight: "700", color: "#9a3412", marginBottom: 8 },
  guidelinesList: { gap: 6 },
  guidelineItem: {},
  guidelineText: { fontSize: 12, color: "#7c2d12", lineHeight: 16 },
});

export default PurokContactScreen;