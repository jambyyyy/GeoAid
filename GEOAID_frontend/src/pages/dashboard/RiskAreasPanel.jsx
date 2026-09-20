import { useMemo, useState } from "react";
import "./RiskAreasPanel.css";

// "Risk areas" sidebar card for the DRRM Evacuation Map.
//
// Setting a risk level on a barangay updates the road condition AND the route
// status (which doubles as the risk level) of the pinned routes that start
// there. The map then redraws the shaded circle for that barangay.
//
//   POST /api/drrm/risk-areas/set/   { barangay, risk_level, road_condition }
//        risk_level: safe | low | medium | high | critical | none (clears it)
//
// Props
//   apiUrl      base URL of the backend (API_URL from ../../config)
//   barangays   mapData.barangays   [{ id, name, ... }]
//   riskAreas   mapData.risk_areas  [{ barangay, risk_level, road_condition, ... }]
//   onChanged   called after a successful save/clear with { barangay, cleared } so the
//               parent can reload the map (and zoom to the barangay)

const RISK_LEVELS = [
  { value: "safe", label: "Safe", color: "#16a34a", suggestedRoad: "clear" },
  { value: "low", label: "Low", color: "#94a3b8", suggestedRoad: "clear" },
  { value: "medium", label: "Medium", color: "#d97706", suggestedRoad: "passable" },
  { value: "high", label: "High", color: "#ea580c", suggestedRoad: "flooded" },
  { value: "critical", label: "Critical", color: "#dc2626", suggestedRoad: "impassable" },
];
const RISK_BY_VALUE = Object.fromEntries(RISK_LEVELS.map((r) => [r.value, r]));

const ROAD_CONDITIONS = [
  { value: "clear", label: "Clear" },
  { value: "passable", label: "Passable" },
  { value: "flooded", label: "Flooded" },
  { value: "landslide_risk", label: "Landslide Risk" },
  { value: "impassable", label: "Impassable" },
];
const ROAD_LABEL = Object.fromEntries(ROAD_CONDITIONS.map((r) => [r.value, r.label]));
const ROAD_ORDER = ROAD_CONDITIONS.map((r) => r.value);

const EMPTY_FORM = { barangay: "", risk_level: "high", road_condition: "flooded" };

function RiskAreasPanel({ apiUrl, barangays = [], riskAreas = [], onChanged }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // One row per barangay: its highest risk level and its worst road condition.
  const flagged = useMemo(() => {
    const byBarangay = new Map();
    riskAreas.forEach((a) => {
      const row = byBarangay.get(a.barangay) || { barangay: a.barangay, level: "safe", road: "clear", routes: 0 };
      if (RISK_LEVELS.findIndex((r) => r.value === a.risk_level) > RISK_LEVELS.findIndex((r) => r.value === row.level)) {
        row.level = a.risk_level;
      }
      const cond = a.road_condition || "clear";
      if (ROAD_ORDER.indexOf(cond) > ROAD_ORDER.indexOf(row.road)) row.road = cond;
      row.routes += 1;
      byBarangay.set(a.barangay, row);
    });
    return [...byBarangay.values()].sort(
      (a, b) =>
        RISK_LEVELS.findIndex((r) => r.value === b.level) - RISK_LEVELS.findIndex((r) => r.value === a.level) ||
        a.barangay.localeCompare(b.barangay)
    );
  }, [riskAreas]);

  const handleLevelChange = (level) => {
    // Suggest a matching road condition, but the officer can still change it.
    setForm((f) => ({ ...f, risk_level: level, road_condition: RISK_BY_VALUE[level].suggestedRoad }));
  };

  const send = async (body) => {
    const response = await fetch(`${apiUrl}/api/drrm/risk-areas/set/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || "Could not update this risk area.");
    return data;
  };

  const handleSave = async () => {
    setError("");
    setNotice("");
    if (!form.barangay) {
      setError("Select a barangay first.");
      return;
    }
    setSaving(true);
    try {
      const data = await send(form);
      setNotice(
        data.route_created
          ? `${data.barangay} flagged ${RISK_BY_VALUE[data.risk_level].label.toLowerCase()} — new route created to ${data.center}.`
          : `${data.barangay} flagged ${RISK_BY_VALUE[data.risk_level].label.toLowerCase()} — ${data.routes_updated} route${data.routes_updated === 1 ? "" : "s"} updated.`
      );
      setForm(EMPTY_FORM);
      if (onChanged) onChanged({ barangay: data.barangay, cleared: false });
    } catch (err) {
      console.error(err);
      setError(err.message === "Failed to fetch" ? "Unable to connect to the server." : err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async (barangay) => {
    setError("");
    setNotice("");
    setClearing(barangay);
    try {
      await send({ barangay, risk_level: "none" });
      setNotice(`${barangay} risk cleared.`);
      if (onChanged) onChanged({ barangay, cleared: true });
    } catch (err) {
      console.error(err);
      setError(err.message === "Failed to fetch" ? "Unable to connect to the server." : err.message);
    } finally {
      setClearing("");
    }
  };

  const handleEdit = (row) => {
    setNotice("");
    setError("");
    setForm({ barangay: row.barangay, risk_level: row.level, road_condition: row.road });
  };

  const selectedColor = RISK_BY_VALUE[form.risk_level]?.color;

  return (
    <section className="panel evac-card risk-panel">
      <h2>Risk areas</h2>
      <p className="evac-hint">
        Set a barangay's risk level and road condition. Its routes update and a shaded circle appears on the map.
      </p>

      <label className="form-field">
        <span className="form-label">Barangay</span>
        <select
          value={form.barangay}
          onChange={(e) => setForm((f) => ({ ...f, barangay: e.target.value }))}
          disabled={saving}
        >
          <option value="">Select a barangay</option>
          {barangays.map((b) => (
            <option key={b.id} value={b.name}>{b.name}</option>
          ))}
        </select>
      </label>

      <div className="form-field">
        <span className="form-label">Risk level</span>
        <div className="risk-level-row">
          {RISK_LEVELS.map((r) => (
            <button
              key={r.value}
              type="button"
              className={`risk-level-chip ${form.risk_level === r.value ? "active" : ""}`}
              style={form.risk_level === r.value ? { background: r.color, borderColor: r.color } : undefined}
              onClick={() => handleLevelChange(r.value)}
              disabled={saving}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <label className="form-field">
        <span className="form-label">Road condition</span>
        <select
          value={form.road_condition}
          onChange={(e) => setForm((f) => ({ ...f, road_condition: e.target.value }))}
          disabled={saving}
        >
          {ROAD_CONDITIONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </label>

      {error ? <p className="form-error">{error}</p> : null}
      {notice ? <p className="risk-notice">{notice}</p> : null}

      <button type="button" className="action-btn drrm-submit-btn" onClick={handleSave} disabled={saving}>
        {saving ? "Saving…" : (
          <>
            <span className="risk-btn-dot" style={{ background: selectedColor }} />
            Set risk area
          </>
        )}
      </button>

      <div className="risk-list-head">Flagged barangays</div>
      {flagged.length === 0 ? (
        <p className="evac-empty">No risk areas yet. Flag a barangay above and its circle will show on the map.</p>
      ) : (
        <ul className="risk-list">
          {flagged.map((row) => {
            const level = RISK_BY_VALUE[row.level] || RISK_BY_VALUE.low;
            return (
              <li key={row.barangay} className="risk-row">
                <span className="risk-row-dot" style={{ background: level.color }} />
                <div className="risk-row-main">
                  <div className="risk-row-name">{row.barangay}</div>
                  <div className="risk-row-meta">
                    {level.label} risk · {ROAD_LABEL[row.road] || row.road} · {row.routes} route{row.routes === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="risk-row-actions">
                  <button type="button" className="risk-link-btn" onClick={() => handleEdit(row)} disabled={saving || clearing === row.barangay}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="risk-link-btn risk-link-btn--danger"
                    onClick={() => handleClear(row.barangay)}
                    disabled={saving || clearing === row.barangay}
                  >
                    {clearing === row.barangay ? "Clearing…" : "Clear"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default RiskAreasPanel;