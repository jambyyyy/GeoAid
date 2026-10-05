import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  NavIconArrow,
  QRIcon,
  BellIcon,
} from "./icons";

const TABS = [
  {
    key: "home",
    label: "Home",
    Icon: QRIcon,
  },
  {
    key: "evacuation",
    label: "Evacuate",
    Icon: NavIconArrow,
  },
  {
    key: "profile",
    label: "Profile",
    Icon: BellIcon,
  },
];

function BottomNav({ active, onSelect }) {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.container,
        {
          paddingBottom: Math.max(insets.bottom, 8),
        },
      ]}
    >
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
              activeOpacity={0.7}
            >
              <View style={styles.iconContainer}>
                <Icon
                  color={
                    isActive
                      ? "#2563eb"
                      : "#9aa3af"
                  }
                />
              </View>

              <Text
                style={[
                  styles.label,
                  isActive && styles.labelActive,
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    backgroundColor: "#ffffff",

    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",

    flexShrink: 0,
  },

  bar: {
    width: "100%",
    height: 62,

    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",

    paddingHorizontal: 8,
  },

  tab: {
    flex: 1,
    height: "100%",

    alignItems: "center",
    justifyContent: "center",
  },

  iconContainer: {
    height: 25,

    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    marginTop: 3,

    fontSize: 12,
    lineHeight: 16,

    color: "#9aa3af",

    textAlign: "center",
  },

  labelActive: {
    color: "#2563eb",
    fontWeight: "600",
  },
});

export default BottomNav;