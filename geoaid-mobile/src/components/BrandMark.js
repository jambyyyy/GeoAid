import { View, Text, StyleSheet } from "react-native";
import { ShieldIcon } from "./icons";

function BrandMark({ subtitle }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <ShieldIcon size={26} color="#fff" />
      </View>
      <Text style={styles.title}>GeoAid</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", marginTop: 24, marginBottom: 8 },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: "#0b4a8f",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#0b1f3a" },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 2 },
});

export default BrandMark;
