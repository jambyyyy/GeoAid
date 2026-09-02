import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../src/components/MobileShell";
import BrandMark from "../src/components/BrandMark";
import { API_BASE } from "../src/api";

// Matches your real login_user view: POST /login/ with
// { username, password, role }. The backend determines the ACTUAL role
// from the account's Django group — "role" here just has to match
// GROUP_ROLE_MAP's "barangay" entry, or login_user rejects the login
// with "not registered under the selected role."
function StaffLoginScreen({ navigation }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your staff username and password.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${API_BASE}/api/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password, role: "barangay" }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setError(data.message || "Invalid staff credentials.");
        return;
      }

      // No session token in this backend — every staff endpoint is
      // scoped by passing ?username= (matched against the account's
      // Django First Name -> barangay), so that's all we persist.
      await AsyncStorage.setItem("geoaid_staff_username", data.username);
      navigation.replace("StaffDashboard");
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MobileShell>
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <BrandMark subtitle="Barangay Evacuation Staff" />
        <Text style={styles.heading}>Staff Sign In</Text>
        <Text style={styles.subheading}>For evacuation center check-in and monitoring</Text>

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Username</Text>
        <TextInput
          style={styles.input}
          placeholder="staff.username"
          autoCapitalize="none"
          value={username}
          onChangeText={setUsername}
          editable={!isSubmitting}
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          placeholder="Enter your password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          editable={!isSubmitting}
        />

        <TouchableOpacity
          style={[styles.signinBtn, isSubmitting && styles.btnDisabled]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Text style={styles.signinBtnText}>{isSubmitting ? "Signing in..." : "Sign In"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.footerRow} onPress={() => navigation.navigate("Login")}>
          <Text style={styles.footerText}>Resident? <Text style={styles.footerLink}>Sign in here</Text></Text>
        </TouchableOpacity>
      </ScrollView>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 12, color: "#0f172a" },
  subheading: { fontSize: 13, color: "#64748b", textAlign: "center", marginTop: 4, marginBottom: 20 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: "#b42318", fontSize: 13 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 12 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  signinBtn: { backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 14, alignItems: "center", marginTop: 22 },
  btnDisabled: { opacity: 0.6 },
  signinBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  footerRow: { marginTop: 24, alignItems: "center" },
  footerText: { fontSize: 13, color: "#64748b" },
  footerLink: { color: "#2563eb", fontWeight: "600" },
});

export default StaffLoginScreen;