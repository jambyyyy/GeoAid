import {
  View,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from "react-native";


function MobileShell({
  children,
}) {
  return (
    <View style={styles.shell}>

      <KeyboardAvoidingView
        style={styles.keyboardView}

        behavior={
          Platform.OS === "ios"
            ? "padding"
            : undefined
        }

        keyboardVerticalOffset={0}
      >

        <View style={styles.content}>
          {children}
        </View>

      </KeyboardAvoidingView>

    </View>
  );
}


const styles = StyleSheet.create({

  shell: {
    flex: 1,

    width: "100%",

    minWidth: 0,
    minHeight: 0,

    backgroundColor: "#f5f7fa",
  },


  keyboardView: {
    flex: 1,

    width: "100%",

    minWidth: 0,
    minHeight: 0,
  },


  content: {
    flex: 1,

    width: "100%",

    minWidth: 0,
    minHeight: 0,
  },

});


export default MobileShell;