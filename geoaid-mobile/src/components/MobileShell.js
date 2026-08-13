import { SafeAreaView, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";

// On the web this wrapped screens in a fixed-width "phone frame" div for
// desktop preview. On an actual phone that's unnecessary — the whole
// screen already *is* the phone frame — so this just handles safe-area
// insets and keyboard avoidance.
function MobileShell({ children }) {
  return (
    <SafeAreaView style={styles.shell}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: "#f5f7fa",
  },
  flex: {
    flex: 1,
  },
});

export default MobileShell;
