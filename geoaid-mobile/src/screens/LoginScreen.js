import { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import MobileShell from "../components/MobileShell";
import BrandMark from "../components/BrandMark";
import { EyeIcon, PhoneIcon } from "../components/icons";
import { API_BASE } from "../api";

function LoginScreen({ navigation, route }) {
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState(route.params?.message || "");
  const [noticeTone, setNoticeTone] = useState(route.params?.tone || "info");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Equivalent of clearing router "state" so the notice doesn't
  // reappear on a future visit to this screen.
  useEffect(() => {
    if (route.params?.message) {
      navigation.setParams({ message: undefined, tone: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async () => {
    setError("");
    setNotice("");

    const trimmedMobile = mobile.trim();
    if (!trimmedMobile) {
      setError("Please enter your mobile number.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(`${API_BASE}/api/resident/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile_number: `+63${trimmedMobile}`,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.status === "pending" || data.status === "rejected" || data.status === "incomplete") {
          setNoticeTone(data.status === "rejected" ? "warning" : "info");
          setNotice(data.message || "Your account isn't ready to sign in yet.");
        } else {
          setError(data.message || "Invalid mobile number or password.");
        }
        return;
      }

      await AsyncStorage.setItem("geoaid_resident_mobile", `+63${trimmedMobile}`);
      navigation.replace("Home");
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
        <BrandMark subtitle="Iligan City DRRM" />

        <Text style={styles.heading}>Welcome back</Text>
        <Text style={styles.subheading}>Sign in to access your household dashboard</Text>

        <View style={styles.form}>
          {notice ? (
            <View style={[styles.notice, noticeTone === "warning" ? styles.noticeWarning : styles.noticeInfo]}>
              <Text style={noticeTone === "warning" ? styles.noticeTextWarning : styles.noticeTextInfo}>
                {notice}
              </Text>
            </View>
          ) : null}
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Text style={styles.label}>Mobile Number</Text>
          <View style={styles.mobileWrap}>
            <Text style={styles.mobilePrefix}>+63</Text>
            <TextInput
              style={styles.mobileInput}
              placeholder="917 234 5678"
              keyboardType="phone-pad"
              value={mobile}
              onChangeText={setMobile}
              editable={!isSubmitting}
            />
          </View>

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordWrap}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Enter your password"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              editable={!isSubmitting}
            />
            <TouchableOpacity
              style={styles.eyeToggle}
              onPress={() => setShowPassword((v) => !v)}
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon off={showPassword} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.forgotRow}>
            <Text style={styles.forgotLink}>Forgot password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.signinBtn, isSubmitting && styles.btnDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <Text style={styles.signinBtnText}>{isSubmitting ? "Signing in..." : "Sign In"}</Text>
          </TouchableOpacity>

          <View style={styles.dividerRow}>
            <View style={styles.dividerLine} />
            <Text style={styles.dividerText}>or</Text>
            <View style={styles.dividerLine} />
          </View>

          <TouchableOpacity style={styles.otpBtn} disabled={isSubmitting}>
            <PhoneIcon />
            <Text style={styles.otpBtnText}>Sign in with OTP</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.footerRow} onPress={() => navigation.navigate("Register")}>
          <Text style={styles.footerText}>
            Not registered yet? <Text style={styles.footerLink}>Create account</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: 12, color: "#0b1f3a" },
  subheading: { fontSize: 13, color: "#6b7280", textAlign: "center", marginTop: 4, marginBottom: 20 },
  form: {},
  notice: { padding: 12, borderRadius: 8, marginBottom: 12, borderWidth: 1 },
  noticeInfo: { backgroundColor: "#eaf3ff", borderColor: "#bcdcff" },
  noticeWarning: { backgroundColor: "#fff4e5", borderColor: "#ffdca8" },
  noticeTextInfo: { color: "#0b4a8f", fontSize: 14, lineHeight: 20 },
  noticeTextWarning: { color: "#8a5a00", fontSize: 14, lineHeight: 20 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: "#b42318", fontSize: 13 },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 12 },
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
  passwordWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 12,
  },
  passwordInput: { flex: 1, paddingVertical: 12, fontSize: 15 },
  eyeToggle: { padding: 4 },
  forgotRow: { alignItems: "flex-end", marginTop: 8 },
  forgotLink: { fontSize: 13, color: "#0b4a8f" },
  signinBtn: {
    backgroundColor: "#0b4a8f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 20,
  },
  btnDisabled: { opacity: 0.6 },
  signinBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  dividerRow: { flexDirection: "row", alignItems: "center", marginVertical: 18, gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: "#e5e7eb" },
  dividerText: { fontSize: 12, color: "#9aa3af" },
  otpBtn: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  otpBtnText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  footerRow: { marginTop: 24, alignItems: "center" },
  footerText: { fontSize: 13, color: "#6b7280" },
  footerLink: { color: "#0b4a8f", fontWeight: "600" },
});

export default LoginScreen;
