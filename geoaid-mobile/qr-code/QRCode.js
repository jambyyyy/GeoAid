import { View, StyleSheet } from "react-native";
import RNQRCode from "react-native-qrcode-svg";

function QRCode({ value, size = 160 }) {
  if (!value) return null;

  return (
    <View style={styles.wrap}>
      <RNQRCode value={value} size={size} color="#0b1f3a" backgroundColor="#ffffff" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default QRCode;