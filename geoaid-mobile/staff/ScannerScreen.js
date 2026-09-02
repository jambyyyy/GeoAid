import { useState, useEffect, useRef } from "react";
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { BackIcon } from "../src/components/icons";
import { API_BASE } from "../src/api";

// Uses expo-camera's built-in barcode scanning (CameraView + onBarcodeScanned)
// rather than the older expo-barcode-scanner package, which is deprecated.
function ScannerScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState("idle"); // idle | checking | success | error
  const [result, setResult] = useState(null);
  const lockRef = useRef(false); // prevents double-firing while one scan is in flight

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted) requestPermission();
  }, [permission]);

  const handleScan = async ({ data: qrValue }) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setStatus("checking");
    setResult(null);

    const username = (await AsyncStorage.getItem("geoaid_staff_username")) || "";

    try {
      const response = await fetch(`${API_BASE}/api/barangay/attendance/scan/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, qr_code: qrValue }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus("error");
        setResult({ message: data.message || "QR code not recognized." });
        return;
      }

      // { action: "checked_in" | "checked_out", member_name, household_name, time }
      setStatus("success");
      setResult(data);
    } catch (err) {
      console.error(err);
      setStatus("error");
      setResult({ message: "Unable to reach the server." });
    }
  };

  const scanAgain = () => {
    lockRef.current = false;
    setStatus("idle");
    setResult(null);
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionText}>Camera access is needed to scan QR codes.</Text>
        <TouchableOpacity style={styles.permissionBtn} onPress={requestPermission}>
          <Text style={styles.permissionBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={status === "idle" ? handleScan : undefined}
      />

      <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} accessibilityLabel="Back">
        <BackIcon />
      </TouchableOpacity>

      <View style={styles.frameWrap} pointerEvents="none">
        <View style={styles.frame} />
        {status === "idle" && <Text style={styles.hint}>Point the camera at a resident's QR code</Text>}
      </View>

      {status !== "idle" && (
        <View style={styles.resultCard}>
          {status === "checking" && (
            <>
              <ActivityIndicator size="small" color="#2563eb" />
              <Text style={styles.resultText}>Checking QR code…</Text>
            </>
          )}

          {status === "success" && (
            <>
              <Text style={styles.resultTitleSuccess}>
                {result?.action === "checked_out" ? "Checked Out" : "Checked In"}
              </Text>
              <Text style={styles.resultName}>{result?.member_name}</Text>
              <Text style={styles.resultMeta}>{result?.household_name}</Text>
              {result?.time && <Text style={styles.resultMeta}>{result.time}</Text>}
              <TouchableOpacity style={styles.scanAgainBtn} onPress={scanAgain}>
                <Text style={styles.scanAgainText}>Scan Next</Text>
              </TouchableOpacity>
            </>
          )}

          {status === "error" && (
            <>
              <Text style={styles.resultTitleError}>Not Recognized</Text>
              <Text style={styles.resultMeta}>{result?.message}</Text>
              <TouchableOpacity style={styles.scanAgainBtn} onPress={scanAgain}>
                <Text style={styles.scanAgainText}>Try Again</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 12 },
  permissionText: { fontSize: 14, color: "#374151", textAlign: "center" },
  permissionBtn: { backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 12, paddingHorizontal: 20 },
  permissionBtnText: { color: "#fff", fontWeight: "700" },
  backBtn: {
    position: "absolute",
    top: 50,
    left: 20,
    padding: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  frameWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  frame: { width: 240, height: 240, borderRadius: 20, borderWidth: 3, borderColor: "#fff" },
  hint: { color: "#fff", fontSize: 13, backgroundColor: "rgba(0,0,0,0.5)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  resultCard: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 20,
    alignItems: "center",
    gap: 4,
  },
  resultText: { fontSize: 13, color: "#374151", marginTop: 8 },
  resultTitleSuccess: { fontSize: 15, fontWeight: "700", color: "#15803d" },
  resultTitleError: { fontSize: 15, fontWeight: "700", color: "#b42318" },
  resultName: { fontSize: 17, fontWeight: "700", color: "#0f172a", marginTop: 4 },
  resultMeta: { fontSize: 13, color: "#64748b" },
  scanAgainBtn: { backgroundColor: "#2563eb", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20, marginTop: 12 },
  scanAgainText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});

export default ScannerScreen;