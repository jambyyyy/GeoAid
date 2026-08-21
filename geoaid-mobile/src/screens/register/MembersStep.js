import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet } from "react-native";
import { Picker } from "@react-native-picker/picker";
import { PlusIcon, ArrowRightIcon } from "../../components/icons";

const RELATIONS = ["Head", "Spouse", "Child", "Parent", "Sibling", "Grandchild", "Other"];

let nextId = 1;
const makeMember = (overrides = {}) => ({
  id: nextId++,
  fullName: "",
  age: "",
  relation: "Other",
  ...overrides,
});

function MembersStep({ headName, initialValue, onContinue, onBack }) {
  const [members, setMembers] = useState(() => {
    if (initialValue?.length) return initialValue;
    return [makeMember({ fullName: headName || "", relation: "Head" })];
  });
  const [error, setError] = useState("");

  const updateMember = (id, field, value) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, [field]: value } : m)));
  };

  const addMember = () => {
    setMembers((prev) => [...prev, makeMember()]);
  };

  const removeMember = (id) => {
    setMembers((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSubmit = () => {
    setError("");

    if (members.length === 0) {
      setError("Add at least the head of household.");
      return;
    }

    for (const m of members) {
      if (!m.fullName.trim()) {
        setError("Every member needs a full name.");
        return;
      }
      const ageNum = Number(m.age);
      if (m.age === "" || Number.isNaN(ageNum) || ageNum < 0 || ageNum > 120) {
        setError(`Enter a valid age for ${m.fullName.trim()}.`);
        return;
      }
    }

    if (!members.some((m) => m.relation === "Head")) {
      setError("One member must be marked as Head of Household.");
      return;
    }

    onContinue(members.map((m) => ({ ...m, fullName: m.fullName.trim(), age: Number(m.age) })));
  };

  return (
    <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <Text style={styles.intro}>
        Add everyone in your household. This list is used for evacuation check-in, so include
        every family member who lives with you.
      </Text>

      <View style={styles.list}>
        {members.map((m, index) => (
          <View style={styles.card} key={m.id}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardNumber}>Member {index + 1}</Text>
              {members.length > 1 && (
                <TouchableOpacity onPress={() => removeMember(m.id)} accessibilityLabel={`Remove member ${index + 1}`}>
                  <Text style={styles.removeBtn}>Remove</Text>
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Juan Dela Cruz"
              value={m.fullName}
              onChangeText={(v) => updateMember(m.id, "fullName", v)}
            />

            <View style={styles.row}>
              <View style={styles.rowField}>
                <Text style={styles.label}>Age</Text>
                <TextInput
                  style={styles.input}
                  keyboardType="number-pad"
                  placeholder="0"
                  value={String(m.age)}
                  onChangeText={(v) => updateMember(m.id, "age", v)}
                />
              </View>
              <View style={styles.rowField}>
                <Text style={styles.label}>Relation</Text>
                <View style={styles.pickerWrap}>
                  <Picker selectedValue={m.relation} onValueChange={(v) => updateMember(m.id, "relation", v)}>
                    {RELATIONS.map((r) => (
                      <Picker.Item key={r} label={r === "Head" ? "Head of Household" : r} value={r} />
                    ))}
                  </Picker>
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.addBtn} onPress={addMember}>
        <PlusIcon />
        <Text style={styles.addBtnText}>Add Another Member</Text>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.backLinkBtn} onPress={onBack}>
          <Text style={styles.backLinkText}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.continueBtn} onPress={handleSubmit}>
          <Text style={styles.continueBtnText}>Next: Vulnerability Assessment</Text>
          <ArrowRightIcon />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  form: { paddingBottom: 32 },
  errorBox: { backgroundColor: "#fdecec", borderWidth: 1, borderColor: "#f5b5b5", borderRadius: 8, padding: 10, marginBottom: 12 },
  errorText: { color: "#b42318", fontSize: 13 },
  intro: { fontSize: 13, color: "#4b5563", lineHeight: 18, marginBottom: 14 },
  list: { gap: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#eef0f3", padding: 14 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardNumber: { fontSize: 13, fontWeight: "700", color: "#0f172a" },
  removeBtn: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  label: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  row: { flexDirection: "row", gap: 12 },
  rowField: { flex: 1 },
  pickerWrap: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, overflow: "hidden" },
  addBtn: {
    flexDirection: "row",
    gap: 8,
    borderWidth: 1,
    borderColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  addBtnText: { color: "#2563eb", fontWeight: "600", fontSize: 14 },
  actions: { flexDirection: "row", gap: 12, marginTop: 20, alignItems: "center" },
  backLinkBtn: { paddingVertical: 14, paddingHorizontal: 8 },
  backLinkText: { color: "#374151", fontWeight: "600", fontSize: 14 },
  continueBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  continueBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },
});

export default MembersStep;
