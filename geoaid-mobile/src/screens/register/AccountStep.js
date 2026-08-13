import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { ShieldIcon, ArrowRightIcon } from "../../components/icons";
import { API_BASE } from "../../api";

function AccountStep({ onContinue }) {
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError("");

    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!/^9\d{9}$/.test(mobile.trim())) {
      setError("Enter a valid mobile number (e.g. 9xx xxx xxxx).");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const payload = {
      full_name: fullName.trim(),
      mobile_number: `+63${mobile.trim()}`,
      password,
    };

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/resident/register/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Could not create the account. Please try again.");
        return;
      }

      onContinue({ ...payload, ...data });
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Full Name</Text>
      <TextInput
        style={styles.input}
        placeholder="Maria Santos"
        value={fullName}
        onChangeText={setFullName}
        editable={!isSubmitting}
      />

      <Text style={styles.label}>Mobile Number</Text>
      <View style={styles.mobileWrap}>
        <Text style={styles.mobilePrefix}>+63</Text>
        <TextInput
          style={styles.mobileInput}
          placeholder="9xx xxx xxxx"
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={setMobile}
          editable={!isSubmitting}
        />
      </View>

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Min. 8 characters"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!isSubmitting}
      />

      <Text style={styles.label}>Confirm Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Repeat password"
        secureTextEntry
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        editable={!isSubmitting}
      />

      <View style={styles.privacyNote}>
        <ShieldIcon />
        <Text style={styles.privacyText}>
          Your data is protected under the Philippine Data Privacy Act (RA 10173). Information is
          only shared with Iligan City LGU agencies.
        </Text>
      </View>

      <TouchableOpacity
        style={[styles.continueBtn, isSubmitting && styles.btnDisabled]}
        onPress={handleSubmit}
        disabled={isSubmitting}
      >
        <Text style={styles.continueBtnText}>{isSubmitting ? "Creating account..." : "Continue"}</Text>
        <ArrowRightIcon />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 32 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: "#b42318", fontSize: 13 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 14 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, fontSize: 15 },
  mobileWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  mobilePrefix: { fontSize: 15, color: "#374151", marginRight: 6 },
  mobileInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  privacyNote: { flexDirection: "row", gap: 8, backgroundColor: "#f5f7fa", borderRadius: 10, padding: 12, marginTop: 18 },
  privacyText: { flex: 1, fontSize: 12, color: "#4b5563", lineHeight: 17 },
  continueBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#0b4a8f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

export default AccountStep;
