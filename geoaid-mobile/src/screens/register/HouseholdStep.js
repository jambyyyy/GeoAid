import { mergeResidentStyles } from "../../residentPolish";
import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import SelectField from "../../components/SelectField";
import { ArrowRightIcon } from "../../components/icons";
import { API_BASE } from "../../api";

// Registration is limited to Iligan City's flood-prone barangays for now.
const FALLBACK_BARANGAYS = [
  "Mahayahay",
  "Tambacan",
  "Abuno",
  "Hinaplanon",
  "Pala-o Riverside",
  "Tubod",
  "Tipanoy",
];

// Mirrors Household.PUROK_CHOICES_BY_BARANGAY on the backend — kept in
// sync as a fallback in case /register/lookups/ isn't reachable yet.
const FALLBACK_PUROKS = {
  Mahayahay: ["Riverside Zone 1", "Riverside Zone 2", "Purok 3"],
  Tambacan: ["Purok 1-A", "Purok 2-A", "Purok 4-B", "Purok 8", "Purok 8-A", "Purok 9"],
  Abuno: ["Purok 6 (Malindawag)", "Panul-iran"],
  Hinaplanon: ["Purok Dao", "Bayug Island"],
  "Pala-o Riverside": ["Purok 15", "Zone 7 / Purok 6"],
  Tubod: ["Purok Manuang", "Purok Green Valley"],
  Tipanoy: ["Purok 1-A (Bernales)", "Purok 4 (Upper Pindugangan)", "Purok 5"],
};

function HouseholdStep({ initialValue, onContinue }) {
  const [barangays, setBarangays] = useState(FALLBACK_BARANGAYS);
  const [puroksByBarangay, setPuroksByBarangay] = useState(FALLBACK_PUROKS);

  const [barangay, setBarangay] = useState(initialValue?.barangay || "");
  const [purok, setPurok] = useState(initialValue?.purok || "");
  const [landmark, setLandmark] = useState(initialValue?.landmark || "");
  const [error, setError] = useState("");

  const puroksForBarangay = puroksByBarangay[barangay] || [];

  useEffect(() => {
    fetch(`${API_BASE}/api/resident/register/lookups/`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.barangays?.length) setBarangays(data.barangays);
        if (data?.puroks) setPuroksByBarangay(data.puroks);
      })
      .catch(() => {
        // Backend not reachable yet — the fallback lists above keep the
        // form usable while offline/dev server is starting up.
      });
  }, []);

  // Reset purok whenever barangay changes so a stale purok from a
  // different barangay never gets submitted.
  const handleBarangayChange = (value) => {
    setBarangay(value);
    setPurok("");
  };

  const handleSubmit = () => {
    setError("");

    if (!barangay) {
      setError("Please select your barangay.");
      return;
    }
    if (!purok) {
      setError("Please select your Purok/Zone.");
      return;
    }

    onContinue({
      barangay,
      purok,
      landmark: landmark.trim(),
      // GPS pinning is disabled for now — kept as null so the payload
      // shape onContinue/RegisterScreen and the backend expect doesn't
      // change when it comes back.
      gpsLat: null,
      gpsLng: null,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Barangay</Text>
      <SelectField
        value={barangay}
        onChange={handleBarangayChange}
        options={barangays}
        placeholder="Select barangay"
      />

      <Text style={styles.label}>Purok / Zone</Text>
      <SelectField
        value={purok}
        onChange={setPurok}
        options={puroksForBarangay}
        placeholder={barangay ? "Select purok/zone" : "Select a barangay first"}
        disabled={!barangay}
      />

      <Text style={styles.label}>Nearest Landmark (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Beside the chapel"
        placeholderTextColor="#64748B"
        selectionColor="#2563EB"
        value={landmark}
        onChangeText={setLandmark}
      />

      <TouchableOpacity style={styles.continueBtn} onPress={handleSubmit}>
        <Text style={styles.continueBtnText}>Next: Household Members</Text>
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
  continueBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
}, "household");

// Always apply explicit high-contrast styles last, including when residentPolish
// injects screen-wide variants or the device is using a dark system theme.
const styles = StyleSheet.create({
  ...themedStyles,
  form: { ...themedStyles.form, paddingTop: 6, paddingBottom: 36 },
  label: { ...themedStyles.label, color: "#1E293B", fontSize: 14, fontWeight: "600", marginTop: 18, marginBottom: 8 },
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
  continueBtn: { ...themedStyles.continueBtn, backgroundColor: "#2563EB", borderRadius: 12, minHeight: 52 },
  continueBtnText: { ...themedStyles.continueBtnText, color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  errorText: { ...themedStyles.errorText, color: "#B42318" },
});

export default HouseholdStep;
