import { useCallback, useEffect, useState } from "react";

const FALLBACK_CATEGORIES = [
  { value: "drrm", label: "DRRM / CDRRMO" },
  { value: "police", label: "Police" },
  { value: "fire", label: "Fire Department" },
  { value: "hospital", label: "Hospital / Medical" },
  { value: "rescue", label: "Rescue / Ambulance" },
  { value: "other", label: "Other" },
];

// DRRM-managed emergency numbers (Police, Fire, Hospital, ...) shown to residents.
// Reading is public; changes need the DRRM password once (server returns a token kept in memory only).
function EmergencyContactsManager({ apiUrl, username }) {
  const [contacts, setContacts] = useState([]);
  const [apiCategories, setApiCategories] = useState([]);
  // Always have a usable category list, even if the list request failed or the server is older.
  const categories = apiCategories.length ? apiCategories : FALLBACK_CATEGORIES;
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [form, setForm] = useState({ id: null, name: "", phone_number: "", category: "drrm" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/api/drrm/emergency-contacts/`);
      const data = await res.json();
      setContacts(data.contacts || []);
      setApiCategories(data.categories || []);
    } catch {
      setError("Could not load emergency contacts.");
    }
  }, [apiUrl]);

  useEffect(() => { load(); }, [load]);

  const unlock = async (e) => {
    e.preventDefault();
    if (busy) return;
    setError(""); setSuccess("");
    if (!password) { setError("Enter your DRRM password."); return; }
    setBusy(true);
    try {
      const res = await fetch(`${apiUrl}/api/drrm/emergency-contacts/unlock/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.token) { setError(data.message || "Could not confirm your password."); return; }
      setToken(data.token);
      setPassword("");
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setBusy(false);
    }
  };

  const send = async (payload, okMessage) => {
    setBusy(true); setError(""); setSuccess("");
    try {
      const res = await fetch(`${apiUrl}/api/drrm/emergency-contacts/manage/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (data === null) {
        setError(`The server returned an unexpected response (HTTP ${res.status}). Make sure the latest backend files are installed and migrated.`);
        return false;
      }
      if (res.status === 401) { setToken(""); setError(data.message || "Confirm your password again."); return false; }
      if (!res.ok || data.success === false) { setError(data.message === "Choose a valid category." ? "The server does not know this category yet. Update models.py and contacts_views.py, run makemigrations and migrate, then restart Django." : (data.message || "Could not save.")); return false; }
      setSuccess(okMessage);
      await load();
      return true;
    } catch (err) {
      setError(`Unable to reach the server at ${apiUrl}. Check that Django is running and the address is correct.`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const reset = () => setForm({ id: null, name: "", phone_number: "", category: "drrm" });

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    const category = categories.some((c) => c.value === form.category) ? form.category : categories[0].value;
    const ok = await send(
      { action: form.id ? "update" : "add", id: form.id, name: form.name, phone_number: form.phone_number, category },
      form.id ? "Contact updated." : "Contact added. Residents will see it in the app."
    );
    if (ok) reset();
  };

  const remove = async (c) => {
    if (busy || !window.confirm(`Remove "${c.name}" from the resident app?`)) return;
    await send({ action: "delete", id: c.id }, "Contact removed.");
    if (form.id === c.id) reset();
  };

  return (
    <section className="panel">
      <h2>Emergency Contacts</h2>
      <p className="panel-note">
        Police, fire, hospital and other numbers residents can call during a disaster. Everything listed here appears in the
        resident mobile app.
      </p>

      {!token ? (
        <form className="drrm-form" onSubmit={unlock}>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="form-grid">
            <label className="form-field">
              <span className="form-label">Your DRRM Password (to add or edit)</span>
              <input type="password" autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} disabled={busy} />
            </label>
          </div>
          <button type="submit" className="action-btn drrm-submit-btn" disabled={busy}>
            {busy ? "Checking…" : "Unlock Editing"}
          </button>
        </form>
      ) : (
        <form className="drrm-form" onSubmit={save}>
          {error ? <p className="form-error">{error}</p> : null}
          {success ? <p className="panel-note">{success}</p> : null}
          <div className="form-grid">
            <label className="form-field">
              <span className="form-label">Name</span>
              <input type="text" placeholder="e.g. Iligan City Police Station" maxLength={100}
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} disabled={busy} />
            </label>
            <label className="form-field">
              <span className="form-label">Phone Number</span>
              <input type="tel" placeholder="e.g. 09171234567, (088) 123 4567 or 911" maxLength={30}
                value={form.phone_number} onChange={(e) => setForm({ ...form, phone_number: e.target.value })} disabled={busy} />
            </label>
            <label className="form-field">
              <span className="form-label">Category</span>
              <select value={categories.some((c) => c.value === form.category) ? form.category : categories[0].value} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={busy}>
                {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" className="action-btn drrm-submit-btn" disabled={busy}>
            {busy ? "Saving…" : form.id ? "Update Contact" : "Add Contact"}
          </button>
          {form.id ? (
            <button type="button" className="action-btn drrm-submit-btn" onClick={reset} disabled={busy} style={{ marginLeft: 8 }}>
              Cancel Edit
            </button>
          ) : null}
        </form>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr><th>Name</th><th>Number</th><th>Category</th><th>Action</th></tr>
          </thead>
          <tbody>
            {contacts.length > 0 ? contacts.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>{c.phone}</td>
                <td>{c.category_label}</td>
                <td>
                  {token ? (
                    <>
                      <button type="button" className="btn-review" disabled={busy}
                        onClick={() => { setError(""); setSuccess(""); setForm({ id: c.id, name: c.name, phone_number: c.phone, category: c.category }); }}>
                        Edit
                      </button>{" "}
                      <button type="button" className="btn-reject" disabled={busy} onClick={() => remove(c)}>Delete</button>
                    </>
                  ) : "—"}
                </td>
              </tr>
            )) : (
              <tr><td colSpan={4}>No emergency contacts added yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default EmergencyContactsManager;
