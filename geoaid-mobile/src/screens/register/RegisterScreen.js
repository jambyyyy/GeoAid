import { useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import MobileShell from "../../components/MobileShell";
import StepProgress, { STEPS } from "../../components/StepProgress";
import { BackIcon } from "../../components/icons";
import AccountStep from "./AccountStep";
import HouseholdStep from "./HouseholdStep";
import MembersStep from "./MembersStep";
import VulnerabilityStep from "./VulnerabilityStep";
import { API_BASE } from "../../api";

function RegisterScreen({ navigation }) {
  const [stepIndex, setStepIndex] = useState(0);

  // Accumulated state across all 4 steps — sent to the backend as one
  // combined submission once Step 4 is completed.
  const [account, setAccount] = useState(null);
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState(null);

  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => {
    if (stepIndex === 0) {
      navigation.navigate("Login");
    } else {
      setStepIndex((i) => i - 1);
    }
  };

  const handleAccountCreated = (accountData) => {
    setAccount(accountData);
    goNext();
  };

  const handleHouseholdContinue = (householdData) => {
    setHousehold(householdData);
    goNext();
  };

  const handleMembersContinue = (membersData) => {
    setMembers(membersData);
    goNext();
  };

  const handleFinish = async ({ flags, isFourPs }) => {
    setSubmitError("");
    setIsSubmitting(true);

    const payload = {
      mobile_number: account?.mobile_number,
      barangay: household?.barangay,
      purok: household?.purok,
      address_line: household?.addressLine,
      landmark: household?.landmark,
      gps_lat: household?.gpsLat,
      gps_lng: household?.gpsLng,
      is_four_ps: isFourPs,
      members: members.map((m) => ({
        full_name: m.fullName,
        age: m.age,
        relation: m.relation,
        is_pwd: flags[m.id]?.isPwd || false,
        pwd_detail: flags[m.id]?.pwdDetail || "",
        is_pregnant: flags[m.id]?.isPregnant || false,
        pregnant_detail: flags[m.id]?.pregnantDetail || "",
      })),
    };

    try {
      const response = await fetch(`${API_BASE}/api/resident/register/complete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSubmitError(data.message || "Could not finish registration. Please try again.");
        return;
      }

      // Registration is submitted but not yet reviewed by the Purok
      // President — don't sign the resident in yet. Send them to login
      // with a message; login_resident will keep rejecting them with a
      // "pending" status until a Purok President approves the household.
      navigation.navigate("Login", {
        message:
          "Registration submitted! Your household is now pending review by your Purok President. You'll be able to log in once it's approved.",
      });
    } catch (err) {
      console.error(err);
      setSubmitError("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MobileShell>
      <View style={styles.screen}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={goBack} accessibilityLabel="Back">
            <BackIcon />
          </TouchableOpacity>
          <View>
            <Text style={styles.title}>Register Household</Text>
            <Text style={styles.subtitle}>
              Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex]} Setup
            </Text>
          </View>
        </View>

        <StepProgress currentIndex={stepIndex} />

        <View style={styles.body}>
          {submitError ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{submitError}</Text>
            </View>
          ) : null}

          {stepIndex === 0 && <AccountStep onContinue={handleAccountCreated} />}

          {stepIndex === 1 && (
            <HouseholdStep initialValue={household} onContinue={handleHouseholdContinue} />
          )}

          {stepIndex === 2 && (
            <MembersStep
              headName={account?.full_name}
              initialValue={members}
              onContinue={handleMembersContinue}
              onBack={goBack}
            />
          )}

          {stepIndex === 3 && (
            <VulnerabilityStep
              members={members || []}
              onFinish={handleFinish}
              onBack={goBack}
              isSubmitting={isSubmitting}
            />
          )}
        </View>
      </View>
    </MobileShell>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingTop: 8 },
  backBtn: { padding: 8, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  title: { fontSize: 17, fontWeight: "700", color: "#0b1f3a" },
  subtitle: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  body: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: "#b42318", fontSize: 13 },
});

export default RegisterScreen;