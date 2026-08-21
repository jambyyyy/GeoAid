import { Modal, Text, TouchableOpacity, View, FlatList, StyleSheet, Pressable } from "react-native";
import { ChevronDownIcon, CheckIcon } from "./icons";
import { useState } from "react";

/**
 * A styled dropdown that opens a bottom-sheet modal list, used instead of
 * the native <Picker>. The native inline Picker renders as a fixed-height
 * platform wheel/list that this app's bordered "pickerWrap" box was
 * clipping (overflow: hidden, no height) — that's what caused the
 * overlapping, half-transparent rows on the Register Household screen.
 * A custom touchable + modal sidesteps that entirely and always looks
 * the same on iOS and Android.
 */
function SelectField({ value, onChange, options, placeholder = "Select an option", disabled = false }) {
  const [open, setOpen] = useState(false);

  const selectedLabel = value || placeholder;

  const handleSelect = (option) => {
    onChange(option);
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity
        style={[styles.field, disabled && styles.fieldDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text
          style={[styles.fieldText, !value && styles.placeholderText]}
          numberOfLines={1}
        >
          {selectedLabel}
        </Text>
        <ChevronDownIcon color={disabled ? "#cbd5e1" : "#64748b"} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{placeholder}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item}
              style={styles.list}
              renderItem={({ item }) => {
                const isSelected = item === value;
                return (
                  <TouchableOpacity
                    style={styles.option}
                    onPress={() => handleSelect(item)}
                  >
                    <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                      {item}
                    </Text>
                    {isSelected && <CheckIcon size={18} />}
                  </TouchableOpacity>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: "#fff",
  },
  fieldDisabled: { backgroundColor: "#f8fafc", borderColor: "#e5e7eb" },
  fieldText: { fontSize: 15, color: "#0f172a", flex: 1, marginRight: 8 },
  placeholderText: { color: "#94a3b8" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingBottom: 24,
    maxHeight: "70%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#e2e8f0",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    paddingHorizontal: 20,
    marginBottom: 4,
  },
  list: { paddingHorizontal: 8 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 14,
    borderRadius: 10,
  },
  optionText: { fontSize: 15, color: "#0f172a" },
  optionTextSelected: { color: "#16a34a", fontWeight: "600" },
});

export default SelectField;
