import { useEffect, useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import * as Location from "expo-location";
import { PinIcon, ArrowRightIcon } from "../../components/icons";
import { API_BASE } from "../../api";

const FALLBACK_BARANGAYS = [
  "Mahayahay",
  "Tambacan",
  "Abuno",
  "Hinaplanon",
  "Pala-o Riverside",
  "Tubod",
  "Tipanoy",
];

function HouseholdStep({ initialValue, onContinue }) {
  const [barangays, setBarangays] = useState(FALLBACK_BARANGAYS);

  const [barangay, setBarangay] = useState(initialValue?.barangay || "");
  const [purok, setPurok] = useState(initialValue?.purok || "");
  const [addressLine, setAddressLine] = useState(initialValue?.addressLine || "");
  const [landmark, setLandmark] = useState(initialValue?.landmark || "");
  const [gps, setGps] = useState(
    initialValue?.gpsLat && initialValue?.gpsLng
      ? { lat: initialValue.gpsLat, lng: initialValue.gpsLng }
      : null
  );
  const [gpsStatus, setGpsStatus] = useState("idle"); // idle | locating | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API_BASE}/api/resident/register/lookups/`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.barangays?.length) setBarangays(data.barangays);
      })
      .catch(() => {
        // Backend not reachable yet — the fallback lists above keep the
        // form usable while offline/dev server is starting up.
      });
  }, []);

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
    if (!purok.trim()) {
      setError("Please enter your Purok/Zone.");
      return;
    }
    if (!addressLine.trim()) {
      setError("Please enter your house no. / street address.");
      return;
    }

    onContinue({
      barangay,
      purok: purok.trim(),
      addressLine: addressLine.trim(),
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
        <Picker selectedValue={barangay} onValueChange={setBarangay}>
          <Picker.Item label="Select barangay" value="" />
          {barangays.map((b) => (
            <Picker.Item key={b} label={b} value={b} />
          ))}
          <Picker.Item label="Other" value="Other" />
        </Picker>
      </View>

      <Text style={styles.label}>Purok / Zone</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Purok 3"
        value={purok}
        onChangeText={setPurok}
      />

      <Text style={styles.label}>House No. / Street</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. 12 Mabuhay St."
        value={addressLine}
        onChangeText={setAddressLine}
      />

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
  gpsHint: { fontSize: 12, color: "#6b7280", marginTop: 8, lineHeight: 17 },
  continueBtn: {
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#0b4a8f",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 22,
  },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});

export default HouseholdStep;