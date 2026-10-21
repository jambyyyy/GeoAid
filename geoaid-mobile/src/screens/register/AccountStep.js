import { mergeResidentStyles } from "../../residentPolish";
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
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Full Name</Text>
      <TextInput
        style={styles.input}
        placeholder="Maria Santos"
        placeholderTextColor="#64748B"
        selectionColor="#2563EB"
        autoCapitalize="words"
        value={fullName}
        onChangeText={setFullName}
        editable={!isSubmitting}
      />

      <Text style={styles.label}>Mobile Number</Text>
      <View style={styles.mobileWrap}>
        <Text style={styles.mobilePrefix}>+63</Text>
        <TextInput
          style={styles.mobileInput}
          placeholder="9XXXXXXXXX"
          placeholderTextColor="#64748B"
          selectionColor="#2563EB"
          keyboardType="phone-pad"
          value={mobile}
          onChangeText={(value) => setMobile(value.replace(/\D/g, "").replace(/^63(?=9)/, "").replace(/^0(?=9)/, "").slice(0, 10))}
          editable={!isSubmitting}
        />
      </View>

      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Min. 8 characters"
        placeholderTextColor="#64748B"
        selectionColor="#2563EB"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
        editable={!isSubmitting}
      />

      <Text style={styles.label}>Confirm Password</Text>
      <TextInput
        style={styles.input}
        placeholder="Repeat password"
        placeholderTextColor="#64748B"
        selectionColor="#2563EB"
        autoCapitalize="none"
        autoCorrect={false}
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

const themedStyles = mergeResidentStyles({
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
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
}, "account");

// Always apply explicit high-contrast styles last, including when residentPolish
// injects screen-wide variants or the device is using a dark system theme.
const styles = StyleSheet.create({
  ...themedStyles,
  form: { ...themedStyles.form, paddingTop: 6, paddingBottom: 36 },
  label: { ...themedStyles.label, color: "#1E293B", fontSize: 14, fontWeight: "600", marginTop: 16, marginBottom: 8 },
  input: {
    ...themedStyles.input,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 12,
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  mobileWrap: {
    ...themedStyles.mobileWrap,
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 52,
    paddingHorizontal: 14,
  },
  mobilePrefix: { ...themedStyles.mobilePrefix, color: "#334155", fontSize: 16, fontWeight: "600", marginRight: 8 },
  mobileInput: {
    ...themedStyles.mobileInput,
    color: "#0F172A",
    backgroundColor: "#FFFFFF",
    fontSize: 16,
    minHeight: 50,
    paddingVertical: 10,
  },
  privacyNote: {
    ...themedStyles.privacyNote,
    backgroundColor: "#EFF6FF",
    borderColor: "#DBEAFE",
    borderWidth: 1,
    marginTop: 24,
    borderRadius: 12,
  },
  privacyText: { ...themedStyles.privacyText, color: "#475569", fontSize: 13, lineHeight: 19 },
  continueBtn: { ...themedStyles.continueBtn, backgroundColor: "#2563EB", borderRadius: 12, minHeight: 52 },
  continueBtnText: { ...themedStyles.continueBtnText, color: "#FFFFFF", fontSize: 16, fontWeight: "700" },
  errorText: { ...themedStyles.errorText, color: "#B42318" },
});

export default AccountStep;
