import { useEffect, useMemo, useState, useCallback } from "react";
import L from "leaflet";
import { MapContainer, TileLayer, Marker, Popup, GeoJSON, useMap, useMapEvents } from "react-leaflet";

/* GeoJSON FeatureCollection of Iligan's barangay polygons (admin_level 10).
   Each feature.properties should include at least `name`, and ideally
   `barangay_id` matching your Barangay table's PK so this map can submit
   the same id your other dropdowns use. See notes at the bottom of this
   file for where to source/export this file. */
const BARANGAYS_URL = "/data/iligan-barangays.geojson";
const API_URL = "/api/evacuation-centers";
const ILIGAN_CENTER = [8.2280, 124.2452];

const STATUS_OPTIONS = ["open", "full", "closed"];

/* ---------- geometry helpers ---------- */

function pointInRing([lng, lat], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        const intersects =
            yi > lat !== yj > lat &&
            lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInPolygon(point, polygon) {
    if (!pointInRing(point, polygon[0])) return false;
    for (let i = 1; i < polygon.length; i++) {
        if (pointInRing(point, polygon[i])) return false;
    }
    return true;
}

function pointInFeatureGeometry(lng, lat, geometry) {
    if (!geometry) return false;
    if (geometry.type === "Polygon") return pointInPolygon([lng, lat], geometry.coordinates);
    if (geometry.type === "MultiPolygon") {
        return geometry.coordinates.some((poly) => pointInPolygon([lng, lat], poly));
    }
    return false;
}

/* ---------- map bits ---------- */

const centerIcon = (status) =>
    L.divIcon({
        className: "",
        html: `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 24 32" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${status === "closed" ? "#dc2626" : "#16a34a"}" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`,
        iconSize: [30, 40],
        iconAnchor: [15, 40],
        popupAnchor: [0, -38],
    });

const pendingIcon = L.divIcon({
    className: "",
    html: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 24 32" style="display:block;filter:drop-shadow(0 2px 2px rgba(0,0,0,.35))"><path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#2563eb" stroke="#fff" stroke-width="1.5"/><circle cx="12" cy="12" r="4.5" fill="#fff"/></svg>`,
    iconSize: [26, 34],
    iconAnchor: [13, 34],
});

function FitToFeature({ feature }) {
    const map = useMap();
    useEffect(() => {
        if (!feature) return;
        const bounds = L.geoJSON(feature).getBounds();
        if (bounds.isValid()) map.fitBounds(bounds.pad(0.15));
    }, [feature, map]);
    return null;
}

function ClickToPlace({ selectedFeature, onPick, onRejected }) {
    useMapEvents({
        click(e) {
            const { lat, lng } = e.latlng;
            if (!selectedFeature) {
                onRejected("Choose a barangay first, then click inside it to place the pin.");
                return;
            }
            if (!pointInFeatureGeometry(lng, lat, selectedFeature.geometry)) {
                onRejected(`That point is outside ${selectedFeature.properties?.name ?? "the selected barangay"}. Click within the highlighted area.`);
                return;
            }
            onPick(lat.toFixed(6), lng.toFixed(6));
        },
    });
    return null;
}

const EMPTY = { name: "", address: "", lat: "", lng: "", capacity: "", status: "open" };

export default function EvacuationMapDRRM() {
    const [barangays, setBarangays] = useState(null);
    const [barangaysError, setBarangaysError] = useState("");
    const [selectedName, setSelectedName] = useState("");

    const [centers, setCenters] = useState([]);
    const [loadingCenters, setLoadingCenters] = useState(true);
    const [listError, setListError] = useState("");

    const [form, setForm] = useState(EMPTY);
    const [error, setError] = useState("");
    const [saving, setSaving] = useState(false);
    const [pendingDelete, setPendingDelete] = useState(null);

    /* --- load barangay boundaries --- */
    useEffect(() => {
        let cancelled = false;
        fetch(BARANGAYS_URL)
            .then((r) => {
                if (!r.ok) throw new Error(String(r.status));
                return r.json();
            })
            .then((data) => !cancelled && setBarangays(data))
            .catch(() => !cancelled && setBarangaysError(
                "Could not load barangay boundaries. Expected a GeoJSON FeatureCollection at " + BARANGAYS_URL
            ));
        return () => { cancelled = true; };
    }, []);

    /* --- load saved centers --- */
    const loadCenters = useCallback(() => {
        setLoadingCenters(true);
        setListError("");
        fetch(API_URL)
            .then((r) => {
                if (!r.ok) throw new Error(String(r.status));
                return r.json();
            })
            .then((data) => setCenters(Array.isArray(data) ? data : []))
            .catch(() => setListError("Could not load saved evacuation centers."))
            .finally(() => setLoadingCenters(false));
    }, []);

    useEffect(() => { loadCenters(); }, [loadCenters]);

    const barangayNames = useMemo(() => {
        if (!barangays) return [];
        return barangays.features
            .map((f) => f.properties?.name)
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b));
    }, [barangays]);

    const selectedFeature = useMemo(() => {
        if (!barangays || !selectedName) return null;
        return barangays.features.find((f) => f.properties?.name === selectedName) || null;
    }, [barangays, selectedName]);

    const handleBarangayChange = (e) => {
        setSelectedName(e.target.value);
        setForm(EMPTY); // a pin only makes sense inside the barangay it was placed in
        setError("");
    };

    const setField = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

    const handlePick = (lat, lng) => {
        setForm((f) => ({ ...f, lat, lng }));
        setError("");
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!selectedFeature) return setError("Select a barangay first.");
        if (!form.name.trim()) return setError("Center name is required.");
        if (!form.address.trim()) return setError("Address is required.");
        if (form.lat === "" || form.lng === "") return setError("Click inside the barangay on the map to place the pin.");

        const lat = Number(form.lat);
        const lng = Number(form.lng);
        if (!pointInFeatureGeometry(lng, lat, selectedFeature.geometry)) {
            return setError("The pin no longer falls inside the selected barangay. Click again to reposition it.");
        }

        const payload = {
            center_name: form.name.trim(),
            barangay_id: selectedFeature.properties?.barangay_id ?? null,
            barangay_name: selectedFeature.properties?.name, // fallback if the backend matches by name
            address: form.address.trim(),
            capacity: form.capacity === "" ? null : Number(form.capacity),
            status: form.status,
            latitude: lat,
            longitude: lng,
        };

        setSaving(true);
        try {
            const res = await fetch(API_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(String(res.status));
            const saved = await res.json();
            setCenters((prev) => [...prev, saved]);
            setForm(EMPTY);
        } catch {
            setError("Could not save the evacuation center. Please try again.");
        } finally {
            setSaving(false);
        }
    };

    const changeStatus = async (center, status) => {
        const prevCenters = centers;
        setCenters((prev) => prev.map((c) => (c.id === center.id ? { ...c, status } : c)));
        try {
            const res = await fetch(`${API_URL}/${center.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status }),
            });
            if (!res.ok) throw new Error(String(res.status));
        } catch {
            setCenters(prevCenters);
            setListError("Could not update that center's status. Please try again.");
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        const target = pendingDelete;
        setPendingDelete(null);
        setCenters((prev) => prev.filter((c) => c.id !== target.id));
        try {
            const res = await fetch(`${API_URL}/${target.id}`, { method: "DELETE" });
            if (!res.ok) throw new Error(String(res.status));
        } catch {
            setCenters((prev) => [...prev, target]);
            setListError("Could not delete that center. Please try again.");
        }
    };

    return (
        <div className="evac-map-wrap">
            <div className="evac-map-layout">
                <div className="evac-map-stage">
                    <MapContainer center={ILIGAN_CENTER} zoom={12} className="evac-map-canvas">
                        <TileLayer
                            attribution="&copy; OpenStreetMap contributors"
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        {/* all barangays, dimmed, for context */}
                        {barangays && (
                            <GeoJSON
                                key={`all-${selectedName}`}
                                data={barangays}
                                style={(feature) => ({
                                    color: feature.properties?.name === selectedName ? "#2563eb" : "#94a3b8",
                                    weight: feature.properties?.name === selectedName ? 3 : 1,
                                    fillColor: feature.properties?.name === selectedName ? "#2563eb" : "#cbd5e1",
                                    fillOpacity: feature.properties?.name === selectedName ? 0.08 : 0.03,
                                })}
                                onEachFeature={(feature, layer) => {
                                    layer.on("click", () => {
                                        setSelectedName(feature.properties?.name || "");
                                        setForm(EMPTY);
                                        setError("");
                                    });
                                }}
                            />
                        )}

                        <FitToFeature feature={selectedFeature} />
                        <ClickToPlace
                            selectedFeature={selectedFeature}
                            onPick={handlePick}
                            onRejected={setError}
                        />

                        {form.lat && form.lng && (
                            <Marker position={[Number(form.lat), Number(form.lng)]} icon={pendingIcon}>
                                <Popup>New center (not saved yet)</Popup>
                            </Marker>
                        )}

                        {centers.map((c) => (
                            <Marker key={c.id} position={[c.latitude, c.longitude]} icon={centerIcon(c.status)}>
                                <Popup>
                                    <strong>{c.center_name}</strong><br />
                                    {c.barangay_name && <>{c.barangay_name}<br /></>}
                                    {c.address && <>{c.address}<br /></>}
                                    {c.capacity != null && <>Capacity: {c.capacity}<br /></>}
                                    Status: {c.status}
                                </Popup>
                            </Marker>
                        ))}
                    </MapContainer>

                    <div className="evac-legend">
                        <div className="evac-legend-group">
                            <span className="evac-legend-title">Centers</span>
                            <span className="evac-legend-item">
                                <i className="evac-legend-square evac-legend-square--ok" /> Open / Full
                            </span>
                            <span className="evac-legend-item">
                                <i className="evac-legend-square evac-legend-square--bad" /> Closed
                            </span>
                        </div>
                    </div>
                </div>

                <aside className="evac-side">
                    <section className="panel evac-card">
                        <h2>Add Evacuation Center</h2>

                        {barangaysError && (
                            <div className="evac-notice evac-notice--warn">
                                {barangaysError}
                            </div>
                        )}

                        <div className="form-field">
                            <label htmlFor="evac-brgy">1. Barangay</label>
                            <select id="evac-brgy" value={selectedName} onChange={handleBarangayChange} disabled={!barangays}>
                                <option value="">Select a barangay</option>
                                {barangayNames.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                ))}
                            </select>
                        </div>

                        <p className="evac-hint">
                            {selectedFeature
                                ? `2. Click inside ${selectedFeature.properties?.name} on the map to place the pin.`
                                : "Selecting a barangay highlights it on the map and lets you place a pin inside it. You can also click any barangay shape directly."}
                        </p>

                        <form className="form-grid" onSubmit={handleSubmit}>
                            <div className="form-field form-field--full">
                                <label htmlFor="evac-name">Center name</label>
                                <input id="evac-name" value={form.name} onChange={setField("name")}
                                       placeholder="e.g. Tambacan Elementary School" disabled={!selectedFeature} />
                            </div>

                            <div className="form-field form-field--full">
                                <label htmlFor="evac-addr">Address</label>
                                <input id="evac-addr" value={form.address} onChange={setField("address")}
                                       placeholder="e.g. Purok 3, near the covered court" disabled={!selectedFeature} />
                            </div>

                            <div className="form-field">
                                <label htmlFor="evac-cap">Capacity (optional)</label>
                                <input id="evac-cap" type="number" min="0" value={form.capacity}
                                       onChange={setField("capacity")} placeholder="e.g. 250" disabled={!selectedFeature} />
                            </div>

                            <div className="form-field">
                                <label htmlFor="evac-status">Status</label>
                                <select id="evac-status" value={form.status} onChange={setField("status")} disabled={!selectedFeature}>
                                    {STATUS_OPTIONS.map((s) => (
                                        <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>
                                    ))}
                                </select>
                            </div>

                            {error && <p className="form-error">{error}</p>}

                            <div className="form-actions">
                                <button type="submit" className="drrm-submit-btn"
                                        disabled={!selectedFeature || !form.lat || saving}>
                                    {saving ? "Saving…" : "Add Center"}
                                </button>
                            </div>
                        </form>
                    </section>

                    <section className="panel evac-card">
                        <h2>Registered Centers</h2>

                        {listError && <p className="form-error">{listError}</p>}

                        {loadingCenters ? (
                            <p className="evac-empty">Loading…</p>
                        ) : centers.length === 0 ? (
                            <p className="evac-empty">No evacuation centers registered yet.</p>
                        ) : (
                            <ul className="evac-route-list">
                                {centers.map((c) => (
                                    <li key={c.id} className="evac-route-option" style={{ cursor: "default" }}>
                                        <div className="evac-route-name">
                                            {c.center_name}
                                            <span className={`evac-tag ${c.status === "closed" ? "evac-tag--bad" : ""}`}>
                                                {c.status}
                                            </span>
                                        </div>
                                        <div className="household-actions">
                                            <select
                                                value={c.status}
                                                onChange={(e) => changeStatus(c, e.target.value)}
                                                className="btn-review"
                                                style={{ paddingRight: 8 }}
                                            >
                                                {STATUS_OPTIONS.map((s) => (
                                                    <option key={s} value={s}>{s}</option>
                                                ))}
                                            </select>
                                            <button type="button" className="btn-reject" onClick={() => setPendingDelete(c)}>
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

            {pendingDelete && (
                <div className="modal-overlay" onClick={() => setPendingDelete(null)}>
                    <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete evacuation center?</h3>
                        <p>
                            "{pendingDelete.center_name}" will be removed and will no longer appear for residents.
                            This can't be undone.
                        </p>
                        <div className="modal-actions">
                            <button className="modal-btn-cancel" onClick={() => setPendingDelete(null)}>Cancel</button>
                            <button className="modal-btn-confirm reject" onClick={confirmDelete}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

