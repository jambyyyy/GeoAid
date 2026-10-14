import { useEffect, useState } from "react";

// DRRM Emergency Hotline form (Settings). Uses the dashboard's existing classes.
// The server re-checks the password and the DRRM role; the username alone is never trusted.
function EmergencyHotlineForm({ apiUrl, username }) {
  const [current, setCurrent] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiUrl}/api/drrm/emergency-hotline/`);
        const data = await res.json();
        setCurrent(data.phone_number || null);
        setPhone(data.phone_number || "");
      } catch {
        setError("Could not load the current hotline.");
      } finally {
        setLoaded(true);
      }
    })();
  }, [apiUrl]);

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    setSuccess("");
    if (!phone.trim()) { setError("Enter the hotline number."); return; }
    if (!password) { setError("Enter your DRRM password to save."); return; }
    setSaving(true);
    try {
      const res = await fetch(`${apiUrl}/api/drrm/emergency-hotline/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, phone_number: phone }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        setError(data.message || "Could not save the hotline.");
        return;
      }
      setCurrent(data.phone_number);
      setPhone(data.phone_number);
      setPassword("");
      setSuccess("Emergency hotline saved. Residents will see it in the mobile app.");
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel">
      <h2>Emergency Hotline</h2>
      <p className="panel-note">
        Official DRRM number shown to residents as "DRRM Emergency Hotline". Current:{" "}
        <strong>{!loaded ? "Loading…" : current || "Not set"}</strong>
      </p>
      <form className="drrm-form" onSubmit={save}>
        {error ? <p className="form-error">{error}</p> : null}
        {success ? <p className="panel-note">{success}</p> : null}
        <div className="form-grid">
          <label className="form-field">
            <span className="form-label">Hotline Number</span>
            <input
              type="tel"
              placeholder="e.g. 09171234567 or (088) 123 4567"
              value={phone}
              maxLength={30}
              onChange={(e) => setPhone(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="form-field">
            <span className="form-label">Your DRRM Password (to confirm)</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={saving}
            />
          </label>
        </div>
        <button type="submit" className="action-btn drrm-submit-btn" disabled={saving}>
          {saving ? "Saving…" : current ? "Update Hotline" : "Save Hotline"}
        </button>
      </form>
    </section>
  );
}

export default EmergencyHotlineForm;
