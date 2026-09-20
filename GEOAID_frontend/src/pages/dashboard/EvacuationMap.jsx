import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./EvacuationMap.css";
import RiskAreasPanel from "./RiskAreasPanel";
import { API_URL } from "../../config";

// Evacuation map for the DRRM Officer dashboard.
//
// Everything here comes from the database through three endpoints:
//   GET  /api/drrm/map/                        barangays, evacuation centers, route risk levels
//   POST /api/drrm/risk-areas/set/             flag / clear a barangay's risk level (RiskAreasPanel)
//   POST /api/drrm/evacuation-centers/create/  register a new evacuation center
//   POST /api/drrm/evacuation-centers/delete/  remove an evacuation center  { id }
//
// The map is plain Leaflet (no react-leaflet), so it doesn't depend on which
// React version the project uses. Run `npm install leaflet` once.

const DEFAULT_CENTER = [8.2286, 124.2381]; // Iligan City
const DEFAULT_ZOOM = 12;

// Risk levels come from evacuation_route.route_status.
const RISK = {
  safe: { label: "Safe", color: "#16a34a" },
  low: { label: "Low", color: "#94a3b8" },
  medium: { label: "Medium", color: "#d97706" },
  high: { label: "High", color: "#ea580c" },
  critical: { label: "Critical", color: "#dc2626" },
};
const RISK_ORDER = ["safe", "low", "medium", "high", "critical"];
const RISK_RADIUS_M = 700; // shaded circle drawn around the barangay's map point

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const pinSvg = (color, width, height) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 24 32" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`;

function centerIcon(center) {
  return L.divIcon({
    className: "",
    html: pinSvg(center.eligible ? "#16a34a" : "#dc2626", 30, 40),
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -38],
  });
}

const pendingIcon = L.divIcon({
  className: "",
  html: pinSvg("#2563eb", 26, 34),
  iconSize: [26, 34],
  iconAnchor: [13, 34],
});

const EMPTY_CENTER_FORM = { name: "", barangay: "", capacity: "", status: "open" };

function EvacuationMap({ onRoutesChanged }) {
  const mapElRef = useRef(null);
  const mapRef = useRef(null);
  const dataLayerRef = useRef(null);
  const newCenterLayerRef = useRef(null);
  const didFitRef = useRef(false);

  const [mapData, setMapData] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // ---- add evacuation center -------------------------------------------
  const [addingCenter, setAddingCenter] = useState(false);
  const addingCenterRef = useRef(false);
  useEffect(() => {
    addingCenterRef.current = addingCenter;
  }, [addingCenter]);

  const [pendingCenter, setPendingCenter] = useState(null); // {lat, lng} | null
  const [centerForm, setCenterForm] = useState(EMPTY_CENTER_FORM);
  const [centerSaving, setCenterSaving] = useState(false);
  const [centerError, setCenterError] = useState("");

  // ---- delete evacuation center ------------------------------------------
  const [centerToDelete, setCenterToDelete] = useState(null); // center object | null
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  // ---- load map data ------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${API_URL}/api/drrm/map/`);
        const data = await response.json();
        if (!cancelled) {
          setMapData(data);
          setLoadError("");
        }
      } catch (err) {
        console.error(err);
        if (!cancelled) setLoadError("Unable to load map data from the server.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  // ---- create the Leaflet map once ---------------------------------------
  useEffect(() => {
    const map = L.map(mapElRef.current, { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    // Stacking order: risk areas < markers.
    map.createPane("evacRisk").style.zIndex = 405;
    map.createPane("evacMarkers").style.zIndex = 450;

    dataLayerRef.current = L.layerGroup().addTo(map);
    newCenterLayerRef.current = L.layerGroup().addTo(map);

    // Clicking the map only does something while placing a new center.
    map.on("click", (e) => {
      if (addingCenterRef.current) {
        setPendingCenter({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(mapElRef.current);

    mapRef.current = map;
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ---- draw risk areas + evacuation centers ------------------------------
  useEffect(() => {
    const map = mapRef.current;
    const group = dataLayerRef.current;
    if (!map || !group || !mapData) return;
    group.clearLayers();

    // Risk areas: one shaded circle per barangay, coloured by its highest risk level.
    const riskByBarangay = new Map();
    (mapData.risk_areas || []).forEach((a) => {
      if (a.latitude == null || a.longitude == null) return;
      const entry = riskByBarangay.get(a.barangay) || { lat: a.latitude, lng: a.longitude, items: [] };
      entry.items.push(a);
      riskByBarangay.set(a.barangay, entry);
    });
    riskByBarangay.forEach((entry, barangay) => {
      const top = entry.items.reduce(
        (best, a) => (RISK_ORDER.indexOf(a.risk_level) > RISK_ORDER.indexOf(best) ? a.risk_level : best),
        "safe"
      );
      const color = (RISK[top] || RISK.low).color;
      const lines = entry.items
        .map((a) => `${escapeHtml((RISK[a.risk_level] || RISK.low).label)}${a.description ? " &mdash; " + escapeHtml(a.description) : ""}`)
        .join("<br>");
      L.circle([entry.lat, entry.lng], {
        pane: "evacRisk",
        radius: RISK_RADIUS_M,
        color,
        weight: 2,
        dashArray: "6 6",
        fillColor: color,
        fillOpacity: 0.22,
      })
        .bindTooltip(`<strong>${escapeHtml(barangay)}</strong><br>Route risk<br>${lines}`, { sticky: true })
        .addTo(group);
    });

    (mapData.centers || []).forEach((c) => {
      L.marker([c.latitude, c.longitude], { pane: "evacMarkers", icon: centerIcon(c), bubblingMouseEvents: false })
        .bindTooltip(
          `<strong>${escapeHtml(c.name)}</strong><br>${escapeHtml(c.barangay)}<br>${c.occupancy}/${c.capacity || "?"} occupied` +
            (c.eligible ? "" : `<br>${escapeHtml(c.ineligible_reason)}`) +
            (c.approximate ? "<br><em>Location approximate (barangay center)</em>" : "")
        )
        .addTo(group);
    });

    if (!didFitRef.current) {
      const centerPts = (mapData.centers || []).map((c) => [c.latitude, c.longitude]);
      const pts = centerPts.length ? centerPts : (mapData.barangays || []).map((b) => [b.latitude, b.longitude]);
      if (pts.length) {
        map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 15 });
        didFitRef.current = true;
      }
    }
  }, [mapData]);

  // ---- draw the pending "new center" pin ----------------------------------
  useEffect(() => {
    const group = newCenterLayerRef.current;
    if (!group) return;
    group.clearLayers();
    if (pendingCenter) {
      L.marker([pendingCenter.lat, pendingCenter.lng], {
        pane: "evacMarkers",
        icon: pendingIcon,
        interactive: false,
      })
        .bindTooltip("New evacuation center (not saved yet)", { permanent: false })
        .addTo(group);
    }
  }, [pendingCenter]);

  // ---- add-center handlers -------------------------------------------------
  const startAddingCenter = () => {
    setAddingCenter(true);
    setPendingCenter(null);
    setCenterForm(EMPTY_CENTER_FORM);
    setCenterError("");
  };

  const cancelAddingCenter = () => {
    setAddingCenter(false);
    setPendingCenter(null);
    setCenterError("");
  };

  const handleSaveCenter = async () => {
    setCenterError("");

    if (!pendingCenter) return setCenterError("Click on the map to place the pin first.");
    if (!centerForm.name.trim()) return setCenterError("Center name is required.");
    if (!centerForm.barangay) return setCenterError("Select the barangay this center belongs to.");

    setCenterSaving(true);
    try {
      const response = await fetch(`${API_URL}/api/drrm/evacuation-centers/create/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: centerForm.name.trim(),
          barangay: centerForm.barangay,
          capacity: centerForm.capacity === "" ? null : Number(centerForm.capacity),
          status: centerForm.status,
          latitude: pendingCenter.lat,
          longitude: pendingCenter.lng,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setCenterError(data.message || "Could not save this evacuation center.");
        return;
      }
      // Reload map data so the new pin appears through the normal render path.
      setRefreshKey((k) => k + 1);
      setAddingCenter(false);
      setPendingCenter(null);
      setCenterForm(EMPTY_CENTER_FORM);
    } catch (err) {
      console.error(err);
      setCenterError("Unable to connect to the server.");
    } finally {
      setCenterSaving(false);
    }
  };

  // ---- risk-area handler ---------------------------------------------------
  // RiskAreasPanel saved (or cleared) a barangay's risk: reload the map so its
  // circle is drawn/removed, refresh the dashboard's route list, and zoom to it.
  const handleRiskChanged = ({ barangay, cleared } = {}) => {
    setRefreshKey((k) => k + 1);
    if (onRoutesChanged) onRoutesChanged();
    if (!cleared && barangay && mapRef.current) {
      const b = (mapData?.barangays || []).find((x) => x.name === barangay);
      if (b) mapRef.current.flyTo([b.latitude, b.longitude], Math.max(mapRef.current.getZoom(), 14), { duration: 0.8 });
    }
  };

  // ---- delete-center handler -----------------------------------------------
  const handleDeleteCenter = async () => {
    if (!centerToDelete) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch(`${API_URL}/api/drrm/evacuation-centers/delete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: centerToDelete.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.success === false) {
        setDeleteError(data.message || "Could not delete this evacuation center.");
        return;
      }
      setCenterToDelete(null);
      setRefreshKey((k) => k + 1);
    } catch (err) {
      console.error(err);
      setDeleteError("Unable to connect to the server.");
    } finally {
      setDeleting(false);
    }
  };

  const missing = mapData?.missing_coordinates || { barangays: [], centers: [] };
  const hasBarangays = (mapData?.barangays || []).length > 0;

  return (
    <div className="evac-map-wrap">
      {loadError ? <p className="form-error">{loadError}</p> : null}

      {mapData && !hasBarangays ? (
        <div className="evac-notice evac-notice--warn">
          <strong>No barangays have coordinates yet.</strong> The map needs a latitude/longitude for each barangay to
          place risk areas. Run <code>python manage.py seed_map_data</code>, or fill them in under Django admin &gt;
          Barangays.
        </div>
      ) : null}

      {mapData && (missing.barangays.length > 0 || missing.centers.length > 0) && hasBarangays ? (
        <div className="evac-notice evac-notice--warn">
          {missing.barangays.length > 0 ? (
            <div>
              <strong>Not on the map (no coordinates):</strong> {missing.barangays.join(", ")}. Add them in Django admin &gt; Barangays.
            </div>
          ) : null}
          {missing.centers.length > 0 ? (
            <div>
              <strong>Evacuation centers that can't be placed:</strong> {missing.centers.join(", ")}. Their barangay needs coordinates.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="evac-map-layout">
        <div className="evac-map-stage">
          <div ref={mapElRef} className="evac-map-canvas" />
          <div className="evac-legend" aria-label="Map legend">
            {(mapData?.risk_areas || []).length > 0 ? (
              <div className="evac-legend-group">
                <span className="evac-legend-title">Route risk</span>
                {RISK_ORDER.map((key) => (
                  <span key={key} className="evac-legend-item">
                    <i className="evac-legend-dot" style={{ background: RISK[key].color }} />
                    {RISK[key].label}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="evac-legend-group">
              <span className="evac-legend-item"><i className="evac-legend-square evac-legend-square--ok" />Open center</span>
              <span className="evac-legend-item"><i className="evac-legend-square evac-legend-square--bad" />Closed / full</span>
            </div>
          </div>
        </div>

        <aside className="evac-side">
          <section className="panel evac-card">
            <h2>Add evacuation center</h2>

            {!addingCenter ? (
              <>
                <p className="evac-hint">Register a new evacuation center by pinning its location on the map.</p>
                <button type="button" className="action-btn drrm-submit-btn" onClick={startAddingCenter}>
                  + Add evacuation center
                </button>
              </>
            ) : (
              <>
                {!pendingCenter ? (
                  <p className="evac-empty">Click anywhere on the map to place the pin.</p>
                ) : (
                  <>
                    <p className="evac-hint">
                      Pin placed at {pendingCenter.lat.toFixed(5)}, {pendingCenter.lng.toFixed(5)}.
                      Click elsewhere on the map to move it.
                    </p>

                    <label className="form-field">
                      <span className="form-label">Center name</span>
                      <input
                        type="text"
                        value={centerForm.name}
                        onChange={(e) => setCenterForm((f) => ({ ...f, name: e.target.value }))}
                        placeholder="e.g. Tambacan Elementary School"
                        disabled={centerSaving}
                      />
                    </label>

                    <label className="form-field">
                      <span className="form-label">Barangay</span>
                      <select
                        value={centerForm.barangay}
                        onChange={(e) => setCenterForm((f) => ({ ...f, barangay: e.target.value }))}
                        disabled={centerSaving}
                      >
                        <option value="">Select a barangay</option>
                        {(mapData?.barangays || []).map((b) => (
                          <option key={b.id} value={b.name}>{b.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="form-field">
                      <span className="form-label">Capacity (optional)</span>
                      <input
                        type="number"
                        min="0"
                        value={centerForm.capacity}
                        onChange={(e) => setCenterForm((f) => ({ ...f, capacity: e.target.value }))}
                        placeholder="e.g. 250"
                        disabled={centerSaving}
                      />
                    </label>

                    <label className="form-field">
                      <span className="form-label">Status</span>
                      <select
                        value={centerForm.status}
                        onChange={(e) => setCenterForm((f) => ({ ...f, status: e.target.value }))}
                        disabled={centerSaving}
                      >
                        <option value="open">Open</option>
                        <option value="closed">Closed</option>
                      </select>
                    </label>
                  </>
                )}

                {centerError ? <p className="form-error">{centerError}</p> : null}

                <div className="modal-actions" style={{ justifyContent: "flex-start" }}>
                  <button
                    type="button"
                    className="action-btn drrm-submit-btn"
                    onClick={handleSaveCenter}
                    disabled={!pendingCenter || centerSaving}
                  >
                    {centerSaving ? "Saving…" : "Save evacuation center"}
                  </button>
                  <button type="button" className="modal-btn-cancel" onClick={cancelAddingCenter} disabled={centerSaving}>
                    Cancel
                  </button>
                </div>
              </>
            )}
          </section>

          <RiskAreasPanel
            apiUrl={API_URL}
            barangays={mapData?.barangays || []}
            riskAreas={mapData?.risk_areas || []}
            onChanged={handleRiskChanged}
          />

          <section className="panel evac-card">
            <h2>Registered centers</h2>
            {(mapData?.centers || []).length === 0 ? (
              <p className="evac-empty">No evacuation centers registered yet.</p>
            ) : (
              <ul className="evac-route-list">
                {(mapData?.centers || []).map((c) => (
                  <li key={c.id} className="evac-route-option" style={{ cursor: "default" }}>
                    <div className="evac-route-name">
                      {c.name}
                      <span className={`evac-tag ${c.eligible ? "" : "evac-tag--bad"}`}>{c.eligible ? "open" : "closed"}</span>
                    </div>
                    <div className="evac-route-meta">{c.barangay}</div>
                    <div className="household-actions">
                      <button
                        type="button"
                        className="btn-reject"
                        onClick={() => {
                          setDeleteError("");
                          setCenterToDelete(c);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {centerToDelete
        ? createPortal(
        <div className="modal-overlay" style={{ zIndex: 10000 }} onClick={() => !deleting && setCenterToDelete(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Delete evacuation center?</h3>
            <p>
              "{centerToDelete.name}" will be removed from the map. This can't be undone.
            </p>
            {deleteError ? <p className="form-error">{deleteError}</p> : null}
            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setCenterToDelete(null)} disabled={deleting}>
                Cancel
              </button>
              <button className="modal-btn-confirm reject" onClick={handleDeleteCenter} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )
        : null}
    </div>
  );
}

export default EvacuationMap;