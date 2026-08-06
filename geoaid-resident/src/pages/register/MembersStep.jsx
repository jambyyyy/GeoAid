import { useState } from "react";
import "./MembersStep.css";

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

  const handleSubmit = (event) => {
    event.preventDefault();
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

    onContinue(
      members.map((m) => ({ ...m, fullName: m.fullName.trim(), age: Number(m.age) }))
    );
  };

  return (
    <form className="members-step" onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}

      <p className="members-intro">
        Add everyone in your household. This list is used for evacuation check-in, so include
        every family member who lives with you.
      </p>

      <div className="members-list">
        {members.map((m, index) => (
          <div className="member-card" key={m.id}>
            <div className="member-card-header">
              <span className="member-number">Member {index + 1}</span>
              {members.length > 1 && (
                <button
                  type="button"
                  className="remove-member-btn"
                  onClick={() => removeMember(m.id)}
                  aria-label={`Remove member ${index + 1}`}
                >
                  Remove
                </button>
              )}
            </div>

            <label htmlFor={`name-${m.id}`}>Full Name</label>
            <input
              id={`name-${m.id}`}
              type="text"
              placeholder="Juan Dela Cruz"
              value={m.fullName}
              onChange={(e) => updateMember(m.id, "fullName", e.target.value)}
            />

            <div className="member-row">
              <div className="member-field">
                <label htmlFor={`age-${m.id}`}>Age</label>
                <input
                  id={`age-${m.id}`}
                  type="number"
                  min="0"
                  max="120"
                  placeholder="0"
                  value={m.age}
                  onChange={(e) => updateMember(m.id, "age", e.target.value)}
                />
              </div>
              <div className="member-field">
                <label htmlFor={`relation-${m.id}`}>Relation</label>
                <select
                  id={`relation-${m.id}`}
                  value={m.relation}
                  onChange={(e) => updateMember(m.id, "relation", e.target.value)}
                >
                  {RELATIONS.map((r) => (
                    <option key={r} value={r}>{r === "Head" ? "Head of Household" : r}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="add-member-btn" onClick={addMember}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        Add Another Member
      </button>

      <div className="members-actions">
        <button type="button" className="back-link-btn" onClick={onBack}>
          Back
        </button>
        <button type="submit" className="continue-btn">
          Next: Vulnerability Assessment
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </form>
  );
}

export default MembersStep;
