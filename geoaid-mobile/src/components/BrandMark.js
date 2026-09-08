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
    backgroundColor: "#2563eb",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  title: { fontSize: 22, fontWeight: "700", color: "#0f172a" },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 2 },
});

export default BrandMark;
