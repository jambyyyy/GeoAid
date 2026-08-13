import { View, Text, StyleSheet } from "react-native";

export const STEPS = ["Account", "Household", "Members", "Vulnerability"];

function StepProgress({ currentIndex }) {
  return (
    <View style={styles.row}>
      {STEPS.map((label, i) => {
        const done = i < currentIndex;
        const active = i === currentIndex;
        return (
          <View key={label} style={styles.stepWrap}>
            <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
              <Text style={[styles.dotText, (done || active) && styles.dotTextActive]}>{i + 1}</Text>
            </View>
            {i < STEPS.length - 1 && <View style={[styles.line, done && styles.lineDone]} />}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  stepWrap: { flexDirection: "row", alignItems: "center", flex: 1 },
  dot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#e5e7eb",
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: { backgroundColor: "#1a7a4c" },
  dotActive: { backgroundColor: "#0b4a8f" },
  dotText: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  dotTextActive: { color: "#fff" },
  line: { flex: 1, height: 2, backgroundColor: "#e5e7eb", marginHorizontal: 4 },
  lineDone: { backgroundColor: "#1a7a4c" },
});

export default StepProgress;
