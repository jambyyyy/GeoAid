import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import * as Location from "expo-location";
import { PinIcon, ArrowRightIcon } from "../../components/icons";
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
  const [gps, setGps] = useState(
    initialValue?.gpsLat && initialValue?.gpsLng
      ? { lat: initialValue.gpsLat, lng: initialValue.gpsLng }
      : null
  );
  const [gpsStatus, setGpsStatus] = useState("idle"); // idle | locating | done | error
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

  const pinLocation = async () => {
    setGpsStatus("locating");
    setError("");

    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      setGpsStatus("error");
      setError("Location permission was denied. You can still continue and pin it later.");
      return;
    }

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      setGps({
        lat: Number(position.coords.latitude.toFixed(6)),
        lng: Number(position.coords.longitude.toFixed(6)),
      });
      setGpsStatus("done");
    } catch (err) {
      setGpsStatus("error");
      setError("Couldn't get your location. You can still continue and pin it later.");
    }
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
      gpsLat: gps?.lat ?? null,
      gpsLng: gps?.lng ?? null,
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.label}>Barangay</Text>
      <View style={styles.pickerWrap}>
        <Picker selectedValue={barangay} onValueChange={handleBarangayChange}>
          <Picker.Item label="Select barangay" value="" />
          {barangays.map((b) => (
            <Picker.Item key={b} label={b} value={b} />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Purok / Zone</Text>
      <View style={styles.pickerWrap}>
        <Picker
          selectedValue={purok}
          onValueChange={setPurok}
          enabled={!!barangay}
        >
          <Picker.Item
            label={barangay ? "Select purok/zone" : "Select a barangay first"}
            value=""
          />
          {puroksForBarangay.map((p) => (
            <Picker.Item key={p} label={p} value={p} />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Nearest Landmark (optional)</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Beside the chapel"
        value={landmark}
        onChangeText={setLandmark}
      />

      <Text style={styles.label}>GPS Pin</Text>
      <TouchableOpacity
        style={[styles.pinBtn, gpsStatus === "done" && styles.pinBtnDone]}
        onPress={pinLocation}
        disabled={gpsStatus === "locating"}
      >
        <PinIcon color={gpsStatus === "done" ? "#15803d" : "#374151"} />
        <Text style={[styles.pinBtnText, gpsStatus === "done" && { color: "#15803d" }]}>
          {gpsStatus === "locating" && "Locating..."}
          {gpsStatus === "done" && `Pinned · ${gps.lat}, ${gps.lng}`}
          {(gpsStatus === "idle" || gpsStatus === "error") && "Use My Current Location"}
        </Text>
      </TouchableOpacity>
      <Text style={styles.gpsHint}>
        Pinning your location helps responders find your household faster during evacuation. You
        can skip this and continue if GPS isn't available right now.
      </Text>

      <TouchableOpacity style={styles.continueBtn} onPress={handleSubmit}>
        <Text style={styles.continueBtnText}>Next: Household Members</Text>
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
  pickerWrap: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, overflow: "hidden" },
  pinBtn: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingVertical: 12,
  },
  pinBtnDone: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  pinBtnText: { fontSize: 14, fontWeight: "600", color: "#374151" },
  gpsHint: { fontSize: 12, color: "#64748b", marginTop: 8, lineHeight: 17 },
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
});

export default HouseholdStep;
