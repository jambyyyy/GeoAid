import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import {
  CameraView,
  useCameraPermissions,
} from "expo-camera";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { BackIcon } from "../src/components/icons";
import { API_BASE } from "../src/api";

export default function ScannerScreen({ navigation, route }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);

  const disasterTypes = route?.params?.disasterTypes || [];
  const [selectedDisasterTypeId, setSelectedDisasterTypeId] = useState(
    disasterTypes.length > 0 ? disasterTypes[0].id : null
  );

  // Running count of people currently checked in today.
  // +1 on check_in, -1 on check_out.
  const [checkInsToday, setCheckInsToday] = useState(0);

  const lockRef = useRef(false);

  useEffect(() => {
    if (!permission) return;

    if (!permission.granted) {
      requestPermission();
    }
  }, [permission]);

  const handleScan = async ({ data }) => {
    if (lockRef.current) return;

    lockRef.current = true;
    setStatus("checking");
    setResult(null);

    try {
      const username =
        (await AsyncStorage.getItem("geoaid_staff_username")) || "";

      const response = await fetch(
        `${API_BASE}/api/barangay/attendance/scan/`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            qr_code: data,
            disaster_type_id: selectedDisasterTypeId,
          }),
        }
      );

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus("error");
        setResult({
          message:
            responseData.message || "QR code not recognized.",
        });
        return;
      }

      setStatus("success");
      setResult(responseData);

      // Update the running check-in counter based on the action returned.
      if (responseData.action === "checked_in") {
        setCheckInsToday((count) => count + 1);
      } else if (responseData.action === "checked_out") {
        setCheckInsToday((count) => Math.max(0, count - 1));
      }
    } catch (error) {
      console.error("SCAN ERROR:", error);

      setStatus("error");
      setResult({
        message: "Unable to reach the server.",
      });
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
        <ActivityIndicator size="large" />

        <Text style={styles.loadingText}>
          Checking camera permission...
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={styles.permissionTitle}>
          Camera Permission Required
        </Text>

        <Text style={styles.permissionText}>
          GeoAid needs camera access to scan resident QR codes.
        </Text>

        <TouchableOpacity
          style={styles.permissionButton}
          onPress={requestPermission}
        >
          <Text style={styles.permissionButtonText}>
            Allow Camera
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.goBackButton}
        >
          <Text style={styles.goBackText}>
            Go Back
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView
        style={styles.camera}
        facing="back"
        active={true}
        barcodeScannerSettings={{
          barcodeTypes: ["qr"],
        }}
        onBarcodeScanned={
          status === "idle" ? handleScan : undefined
        }
        onMountError={(error) => {
          console.log("CAMERA MOUNT ERROR:", error);
        }}
      />

      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
        >
          <BackIcon size={24} color="#ffffff" />
        </TouchableOpacity>

        <Text style={styles.title}>
          Scan QR Code
        </Text>

        <View style={styles.countBadge}>
          <Text style={styles.countBadgeText}>
            {checkInsToday}
          </Text>
        </View>
      </View>

      {disasterTypes.length > 0 && status === "idle" && (
        <View style={styles.disasterBar}>
          <Text style={styles.disasterBarLabel}>Tagging check-ins to:</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.disasterChipRow}
          >
            <TouchableOpacity
              style={[
                styles.disasterChip,
                selectedDisasterTypeId === null && styles.disasterChipActive,
              ]}
              onPress={() => setSelectedDisasterTypeId(null)}
            >
              <Text
                style={[
                  styles.disasterChipText,
                  selectedDisasterTypeId === null && styles.disasterChipTextActive,
                ]}
              >
                None
              </Text>
            </TouchableOpacity>

            {disasterTypes.map((dt) => (
              <TouchableOpacity
                key={dt.id}
                style={[
                  styles.disasterChip,
                  selectedDisasterTypeId === dt.id && styles.disasterChipActive,
                ]}
                onPress={() => setSelectedDisasterTypeId(dt.id)}
              >
                <Text
                  style={[
                    styles.disasterChipText,
                    selectedDisasterTypeId === dt.id && styles.disasterChipTextActive,
                  ]}
                >
                  {dt.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {status === "idle" && (
        <View style={styles.scanContainer}>
          <View style={styles.scanBox}>
            <View
              style={[
                styles.corner,
                styles.topLeft,
              ]}
            />

            <View
              style={[
                styles.corner,
                styles.topRight,
              ]}
            />

            <View
              style={[
                styles.corner,
                styles.bottomLeft,
              ]}
            />

            <View
              style={[
                styles.corner,
                styles.bottomRight,
              ]}
            />
          </View>

          <Text style={styles.instruction}>
            Place the QR code inside the frame
          </Text>
        </View>
      )}

      {status === "checking" && (
        <View style={styles.messageBox}>
          <ActivityIndicator
            size="large"
            color="#ffffff"
          />

          <Text style={styles.messageTitle}>
            Checking attendance...
          </Text>
        </View>
      )}

      {status === "success" &&
        result?.action === "checked_in" && (
          <View style={styles.messageBox}>
            <Text style={styles.successTitle}>
              ✓ Checked In
            </Text>

            <Text style={styles.messageText}>
              {result.member_name}
            </Text>

            <Text style={styles.messageText}>
              {result.household_name}
            </Text>

            <Text style={styles.timeText}>
              {result.time}
            </Text>

            {result.disaster_type ? (
              <Text style={styles.disasterTagText}>
                Tagged to: {result.disaster_type}
              </Text>
            ) : null}

            <Text style={styles.countText}>
              Checked in today: {checkInsToday}
            </Text>

            <TouchableOpacity
              style={styles.scanAgainButton}
              onPress={scanAgain}
            >
              <Text style={styles.scanAgainText}>
                Scan Again
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {status === "success" &&
        result?.action === "checked_out" && (
          <View style={styles.messageBox}>
            <Text style={styles.checkoutTitle}>
              ✓ Checked Out
            </Text>

            <Text style={styles.messageText}>
              {result.member_name}
            </Text>

            <Text style={styles.messageText}>
              {result.household_name}
            </Text>

            <Text style={styles.timeText}>
              {result.time}
            </Text>

            <Text style={styles.countText}>
              Checked in today: {checkInsToday}
            </Text>

            <TouchableOpacity
              style={styles.scanAgainButton}
              onPress={scanAgain}
            >
              <Text style={styles.scanAgainText}>
                Scan Again
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {status === "success" &&
        !result?.action && (
          <View style={styles.messageBox}>
            <Text style={styles.successTitle}>
              ✓ Attendance Recorded
            </Text>

            {result?.message && (
              <Text style={styles.messageText}>
                {result.message}
              </Text>
            )}

            <TouchableOpacity
              style={styles.scanAgainButton}
              onPress={scanAgain}
            >
              <Text style={styles.scanAgainText}>
                Scan Again
              </Text>
            </TouchableOpacity>
          </View>
        )}

      {status === "error" && (
        <View style={styles.messageBox}>
          <Text style={styles.errorTitle}>
            ✕ Scan Failed
          </Text>

          <Text style={styles.messageText}>
            {result?.message || "QR code not recognized."}
          </Text>

          <TouchableOpacity
            style={styles.scanAgainButton}
            onPress={scanAgain}
          >
            <Text style={styles.scanAgainText}>
              Try Again
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {status === "idle" && (
        <View style={styles.bottomInfo}>
          <Text style={styles.bottomTitle}>
            Scan Resident QR Code
          </Text>

          <Text style={styles.bottomText}>
            Scan once to check in. Scan the same QR code
            again to check out.
          </Text>

          <Text style={styles.bottomCountText}>
            Checked in today: {checkInsToday}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "black",
  },

  camera: {
    flex: 1,
  },

  topBar: {
    position: "absolute",
    top: 45,
    left: 0,
    right: 0,
    height: 55,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 10,
  },

  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  title: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "700",
  },

  countBadge: {
    minWidth: 44,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },

  countBadgeText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
  },

  disasterBar: {
    position: "absolute",
    top: 105,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    zIndex: 10,
  },

  disasterBarLabel: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 8,
  },

  disasterChipRow: {
    gap: 8,
  },

  disasterChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
  },

  disasterChipActive: {
    backgroundColor: "#ffffff",
    borderColor: "#ffffff",
  },

  disasterChipText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },

  disasterChipTextActive: {
    color: "#0b1f3a",
  },

  disasterTagText: {
    color: "#9fd8ff",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
  },

  scanContainer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 5,
  },

  scanBox: {
    width: 260,
    height: 260,
    position: "relative",
  },

  corner: {
    position: "absolute",
    width: 45,
    height: 45,
    borderColor: "#ffffff",
  },

  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: 4,
    borderLeftWidth: 4,
  },

  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: 4,
    borderRightWidth: 4,
  },

  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 4,
    borderLeftWidth: 4,
  },

  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 4,
    borderRightWidth: 4,
  },

  instruction: {
    marginTop: 25,
    color: "#ffffff",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 30,
  },

  bottomInfo: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 30,
    padding: 20,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.65)",
    zIndex: 10,
  },

  bottomTitle: {
    color: "#ffffff",
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 8,
  },

  bottomText: {
    color: "#dddddd",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 19,
  },

  bottomCountText: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 12,
  },

  messageBox: {
    position: "absolute",
    left: 20,
    right: 20,
    bottom: 30,
    padding: 25,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.88)",
    alignItems: "center",
    zIndex: 20,
  },

  messageTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "700",
    marginTop: 15,
  },

  successTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },

  checkoutTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },

  errorTitle: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 10,
  },

  messageText: {
    color: "#ffffff",
    fontSize: 16,
    textAlign: "center",
    marginTop: 6,
  },

  timeText: {
    color: "#ffffff",
    fontSize: 14,
    marginTop: 8,
  },

  countText: {
    color: "#9fd8ff",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 10,
  },

  scanAgainButton: {
    marginTop: 20,
    paddingHorizontal: 25,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: "#ffffff",
  },

  scanAgainText: {
    color: "#0b1f3a",
    fontSize: 16,
    fontWeight: "700",
  },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 25,
    backgroundColor: "#ffffff",
  },

  loadingText: {
    marginTop: 15,
    fontSize: 16,
  },

  permissionTitle: {
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
  },

  permissionText: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 25,
  },

  permissionButton: {
    backgroundColor: "#0b1f3a",
    paddingHorizontal: 30,
    paddingVertical: 14,
    borderRadius: 8,
  },

  permissionButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },

  goBackButton: {
    marginTop: 15,
    padding: 12,
  },

  goBackText: {
    color: "#0b1f3a",
    fontSize: 16,
  },
});