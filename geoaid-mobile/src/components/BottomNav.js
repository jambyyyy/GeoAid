import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { NavIconArrow, QRIcon, BellIcon } from "./icons";

const TABS = [
  { key: "home", label: "Home", Icon: QRIcon },
  { key: "evacuation", label: "Evacuate", Icon: NavIconArrow },
  { key: "profile", label: "Profile", Icon: BellIcon },
];

function BottomNav({ active, onSelect }) {
  return (
    <View style={styles.bar}>
      {TABS.map(({ key, label, Icon }) => {
        const isActive = active === key;
        return (
          <TouchableOpacity
            key={key}
            style={styles.tab}
            onPress={() => onSelect(key)}
            accessibilityRole="button"
            accessibilityLabel={label}
          >
            <Icon color={isActive ? "#2563eb" : "#9aa3af"} />
            <Text style={[styles.label, isActive && styles.labelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#fff",
    paddingVertical: 8,
  },
  tab: { flex: 1, alignItems: "center", gap: 4 },
  label: { fontSize: 12, color: "#9aa3af" },
  labelActive: { color: "#2563eb", fontWeight: "600" },
});

export default BottomNav;
