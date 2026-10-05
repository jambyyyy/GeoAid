import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./DRRMDashboard.css";
import Sidebar from "../../components/sidebar";
import { Paginated } from "../../components/Pagination";
import EvacuationMap from "./EvacuationMap";
import { API_URL } from "../../config";

// Reorganized to match the thesis's actual DRRM use case: "DRRMC can
// log in, manage disaster situations and evacuation routes, monitor
// route risk, generate reports, and log out." Disaster Situation and
// Safety Evacuation Route live together as sub-tabs of one section
// below rather than as separate top-level nav items.
const navItems = ["Dashboard", "Situations & Routes", "Evacuation Map", "Reports", "Settings"];

// Remembers the selected page/tab in sessionStorage so a browser refresh
// keeps you where you were instead of jumping back to "Dashboard". The
// saved value is cleared on logout and ignored if it is no longer valid.
function usePersistedChoice(key, fallback, isValid) {
  const [value, setValue] = useState(() => {
    try {
      const saved = sessionStorage.getItem(key);
      if (saved && isValid(saved)) return saved;
    } catch {
      /* storage unavailable — use the default */
    }
    return fallback;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  }, [key, value]);

  return [value, setValue];
}

const sectionInfo = {
  "Dashboard": { title: "DRRM Officer Dashboard", subtitle: "City-wide disaster management & evacuation overview" },
  "Situations & Routes": { title: "Disaster Situations & Routes", subtitle: "Disaster situations and evacuation routes" },
  "Evacuation Map": { title: "Evacuation Map", subtitle: "Fastest route to the nearest open evacuation center, updated with road conditions" },
  "Reports": { title: "Reports", subtitle: "Situation, disaster monitoring, and relief & vulnerability reports" },
  "Settings": { title: "Settings", subtitle: "Manage your DRRM Officer account preferences" },
};

const ROAD_CONDITION_LABEL = {
  clear: "Clear",
  passable: "Passable",
  flooded: "Flooded",
  landslide_risk: "Landslide Risk",
  impassable: "Impassable",
};

// route_status also carries the route's risk level (safe .. critical).
const ROUTE_STATUS_LABEL = {
  active: "Active",
  under_review: "Under Review",
  blocked: "Blocked",
  safe: "Safe",
  low: "Low Risk",
  medium: "Medium Risk",
  high: "High Risk",
  critical: "Critical Risk",
};

// Badge colours for the risk-level statuses (the older three keep their CSS classes).
const ROUTE_STATUS_STYLE = {
  safe: { background: "#dcfce7", color: "#166534" },
  low: { background: "#f1f5f9", color: "#475569" },
  medium: { background: "#fef3c7", color: "#92400e" },
  high: { background: "#ffedd5", color: "#9a3412" },
  critical: { background: "#fee2e2", color: "#991b1b" },
};

const DISASTER_STATUS_LABEL = {
  active: "Active",
  closed: "Closed",
};

const EMPTY_ROUTE_FORM = {
  evacuation_center_id: "",
  start_location: "",
  route_distance: "",
  estimated_time: "",
  road_condition: "clear",
  route_status: "active",
};

const EMPTY_DISASTER_TYPE_FORM = {
  disaster_type_name: "",
  start_date: "",
  end_date: "",
  status: "active",
};

const formatDate = (iso) => {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
};

// Inputs inside table cells (the inline "Edit" row of Disaster Situations).
const CELL_INPUT_STYLE = {
  width: "100%",
  minWidth: 110,
  padding: "6px 8px",
  border: "1px solid #d1d5db",
  borderRadius: 8,
  fontSize: 13,
  background: "#fff",
};

function DRRMDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "DRRM Officer";

  // --- Generate Report form: title + content -> downloadable PDF ---
  const [reportForm, setReportForm] = useState({
    title: "",
    content: "",
    disaster_type_id: "",
  });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFormError, setReportFormError] = useState("");
  const handleReportFieldChange = (field, value) => {
    setReportForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerateReport = async (e) => {
    e.preventDefault();
    setReportFormError("");

    if (!reportForm.title.trim() || !reportForm.content.trim()) {
      setReportFormError("Title and content are required.");
      return;
    }

    setIsSubmittingReport(true);
    try {
      // The server builds the PDF (your title + content on top, then the
      // latest data for your role) and sends it back as a download.
      const response = await fetch(`${API_URL}/api/reports/pdf/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reportForm, username }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setReportFormError(data.message || "Could not generate this report. Please try again.");
        return;
      }

      const cd = response.headers.get("Content-Disposition") || "";
      const match = /filename="?([^"]+)"?/.exec(cd);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = match ? match[1] : "GeoAid_Report.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setReportForm({ title: "", content: "", disaster_type_id: "" });
    } catch (err) {
      console.error(err);
      setReportFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const [activeItem, setActiveItem] = usePersistedChoice("geoaid_drrm_page", "Dashboard", (v) => v in sectionInfo);
  const [locationSubTab, setLocationSubTab] = usePersistedChoice("geoaid_drrm_subtab", "Situations", (v) => ["Situations", "Routes"].includes(v)); // Situations | Routes

  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // --- Disaster situations (dropdown data shared with the Routes tab) ---
  const [locationsData, setLocationsData] = useState({ barangays: [], disaster_types: [] });

  // --- 3.2 Disaster Situation ---
  const [disasterTypeForm, setDisasterTypeForm] = useState(EMPTY_DISASTER_TYPE_FORM);
  const [disasterTypeSubmitting, setDisasterTypeSubmitting] = useState(false);
  const [disasterTypeFormError, setDisasterTypeFormError] = useState("");

  // --- Edit / delete a disaster situation ---
  const [editingSituationId, setEditingSituationId] = useState(null);
  const [situationDraft, setSituationDraft] = useState(EMPTY_DISASTER_TYPE_FORM);
  const [situationSaving, setSituationSaving] = useState(false);
  const [situationEditError, setSituationEditError] = useState("");
  const [situationToDelete, setSituationToDelete] = useState(null); // situation | null
  const [situationDeleting, setSituationDeleting] = useState(false);
  const [situationDeleteError, setSituationDeleteError] = useState("");

  // --- 3.3 Safety Evacuation Route ---
  const [routesData, setRoutesData] = useState({ centers: [], routes: [] });
  const [routeForm, setRouteForm] = useState(EMPTY_ROUTE_FORM);
  const [routeSubmitting, setRouteSubmitting] = useState(false);
  const [routeFormError, setRouteFormError] = useState("");

  // --- Edit a pinned route's road condition / status (risk level) ---
  const [editingRouteId, setEditingRouteId] = useState(null);
  const [editingRouteStatus, setEditingRouteStatus] = useState("active");
  const [editingRoadCondition, setEditingRoadCondition] = useState("clear");
  const [routeEditSaving, setRouteEditSaving] = useState(false);
  const [routeEditError, setRouteEditError] = useState("");

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(`${API_URL}/api/drrm/dashboard/`);
        const data = await response.json();
        setDashboardData(data);
      } catch (err) {
        console.error(err);
        setError("Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
  }, []);

  const fetchLocations = async () => {
    try {
      const response = await fetch(`${API_URL}/api/drrm/disaster-types/`);
      const data = await response.json();
      setLocationsData({
        barangays: data.barangays || [],
        disaster_types: data.disaster_types || [],
      });
    } catch (err) {
      console.error(err);
    }
  };

  const fetchRoutes = async () => {
    try {
      const response = await fetch(`${API_URL}/api/drrm/routes/`);
      const data = await response.json();
      setRoutesData({ centers: data.centers || [], routes: data.routes || [] });
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    fetchLocations();
    fetchRoutes();
  }, []);

  const handleDisasterTypeFormChange = (field, value) => {
    setDisasterTypeForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddDisasterType = async (e) => {
    e.preventDefault();
    setDisasterTypeFormError("");

    if (!disasterTypeForm.disaster_type_name.trim()) {
      setDisasterTypeFormError("Disaster name is required.");
      return;
    }

    setDisasterTypeSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/drrm/disaster-types/add/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...disasterTypeForm,
          disaster_type_name: disasterTypeForm.disaster_type_name.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setDisasterTypeFormError(data.message || "Could not add this disaster situation.");
        return;
      }

      await fetchLocations(); // reload so the new row carries its dates / record counts
      setDisasterTypeForm(EMPTY_DISASTER_TYPE_FORM);
    } catch (err) {
      console.error(err);
      setDisasterTypeFormError("Unable to connect to the server.");
    } finally {
      setDisasterTypeSubmitting(false);
    }
  };

  const startEditSituation = (dt) => {
    setEditingSituationId(dt.id);
    setSituationDraft({
      disaster_type_name: dt.name,
      start_date: dt.start_date || "",
      end_date: dt.end_date || "",
      status: dt.status,
    });
    setSituationEditError("");
  };

  const cancelEditSituation = () => {
    setEditingSituationId(null);
    setSituationEditError("");
  };

  const handleSaveSituation = async (dt) => {
    const name = situationDraft.disaster_type_name.trim();
    if (!name) {
      setSituationEditError("Disaster name is required.");
      return;
    }
    if (situationDraft.start_date && situationDraft.end_date && situationDraft.end_date < situationDraft.start_date) {
      setSituationEditError("End date can't be before the start date.");
      return;
    }
    if (
      name === dt.name &&
      situationDraft.start_date === (dt.start_date || "") &&
      situationDraft.end_date === (dt.end_date || "") &&
      situationDraft.status === dt.status
    ) {
      cancelEditSituation();
      return;
    }

    setSituationSaving(true);
    setSituationEditError("");
    try {
      const response = await fetch(`${API_URL}/api/drrm/disaster-types/update/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: dt.id,
          disaster_type_name: name,
          start_date: situationDraft.start_date,
          end_date: situationDraft.end_date,
          status: situationDraft.status,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setSituationEditError(data.message || "Could not update this disaster situation.");
        return;
      }

      setLocationsData((prev) => ({
        ...prev,
        disaster_types: prev.disaster_types.map((x) => (x.id === dt.id ? data.disaster_type : x)),
      }));
      setEditingSituationId(null);
    } catch (err) {
      console.error(err);
      setSituationEditError("Unable to connect to the server.");
    } finally {
      setSituationSaving(false);
    }
  };

  const handleDeleteSituation = async () => {
    if (!situationToDelete) return;
    setSituationDeleting(true);
    setSituationDeleteError("");
    try {
      const response = await fetch(`${API_URL}/api/drrm/disaster-types/delete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: situationToDelete.id }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.success === false) {
        setSituationDeleteError(data.message || "Could not delete this disaster situation.");
        return;
      }

      setLocationsData((prev) => ({
        ...prev,
        disaster_types: prev.disaster_types.filter((x) => x.id !== situationToDelete.id),
      }));
      setSituationToDelete(null);
    } catch (err) {
      console.error(err);
      setSituationDeleteError("Unable to connect to the server.");
    } finally {
      setSituationDeleting(false);
    }
  };

  // For a situation that can't be deleted (it has linked records): close it instead.
  const handleCloseSituationInstead = async () => {
    if (!situationToDelete) return;
    setSituationDeleting(true);
    setSituationDeleteError("");
    try {
      const response = await fetch(`${API_URL}/api/drrm/disaster-types/update/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: situationToDelete.id, status: "closed" }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setSituationDeleteError(data.message || "Could not close this disaster situation.");
        return;
      }

      setLocationsData((prev) => ({
        ...prev,
        disaster_types: prev.disaster_types.map((x) => (x.id === situationToDelete.id ? data.disaster_type : x)),
      }));
      setSituationToDelete(null);
    } catch (err) {
      console.error(err);
      setSituationDeleteError("Unable to connect to the server.");
    } finally {
      setSituationDeleting(false);
    }
  };

  const handleRouteFormChange = (field, value) => {
    setRouteForm((prev) => ({ ...prev, [field]: value }));
  };

  const handlePinRoute = async (e) => {
    e.preventDefault();
    setRouteFormError("");

    if (!routeForm.evacuation_center_id || !routeForm.start_location.trim()) {
      setRouteFormError("Evacuation center and start location are required.");
      return;
    }

    setRouteSubmitting(true);
    try {
      const response = await fetch(`${API_URL}/api/drrm/routes/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...routeForm,
          start_location: routeForm.start_location.trim(),
          route_distance: routeForm.route_distance.trim(),
          estimated_time: routeForm.estimated_time.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        setRouteFormError(data.message || "Could not pin this route.");
        return;
      }

      setRoutesData((prev) => ({ ...prev, routes: [data.route, ...prev.routes] }));
      setRouteForm(EMPTY_ROUTE_FORM);
    } catch (err) {
      console.error(err);
      setRouteFormError("Unable to connect to the server.");
    } finally {
      setRouteSubmitting(false);
    }
  };

  const startEditRouteStatus = (route) => {
    setEditingRouteId(route.id);
    setEditingRouteStatus(route.route_status);
    setEditingRoadCondition(route.road_condition);
    setRouteEditError("");
  };

  const cancelEditRouteStatus = () => {
    setEditingRouteId(null);
    setRouteEditError("");
  };

  const handleSaveRouteStatus = async (route) => {
    if (editingRouteStatus === route.route_status && editingRoadCondition === route.road_condition) {
      cancelEditRouteStatus();
      return;
    }
    setRouteEditSaving(true);
    setRouteEditError("");
    try {
      const response = await fetch(`${API_URL}/api/drrm/routes/update/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: route.id,
          route_status: editingRouteStatus,
          road_condition: editingRoadCondition,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setRouteEditError(data.message || "Could not update this route.");
        return;
      }

      setRoutesData((prev) => ({
        ...prev,
        routes: prev.routes.map((r) => (r.id === route.id ? data.route : r)),
      }));
      setEditingRouteId(null);
    } catch (err) {
      console.error(err);
      setRouteEditError("Unable to connect to the server.");
    } finally {
      setRouteEditSaving(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    sessionStorage.removeItem("geoaid_drrm_page");
    sessionStorage.removeItem("geoaid_drrm_subtab");
    navigate("/");
  };

  const { title, subtitle } = sectionInfo[activeItem];

  if (loading) {
    return (
      <div className="dashboard-page">
        <div className="loading-container">
          <h2>Loading Dashboard...</h2>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <div className="error-container">
          <h2>{error}</h2>
        </div>
      </div>
    );
  }

  const priority = dashboardData?.priority_beneficiaries || {};

  return (
    <div className="dashboard-page">
      <Sidebar
        role="DRRM Officer Portal"
        navItems={navItems}
        activeItem={activeItem}
        onNavItemClick={setActiveItem}
      />

      <div className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="header-actions">
            <span className="user-badge">Signed in as {username}</span>
            <button type="button" className="logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {activeItem === "Dashboard" && (
          <>
            <section className="stats-grid">
              <article className="stat-card stat-success">
                <span className="stat-value">{dashboardData?.total_households ?? 0}</span>
                <span className="stat-label">Confirmed Households</span>
              </article>
              <article className="stat-card stat-warning">
                <span className="stat-value">{dashboardData?.awaiting_barangay_confirmation ?? 0}</span>
                <span className="stat-label">Awaiting Barangay Confirmation</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{dashboardData?.pending_review ?? 0}</span>
                <span className="stat-label">Awaiting Purok Review</span>
              </article>
              <article className="stat-card stat-danger">
                <span className="stat-value">{dashboardData?.rejected ?? 0}</span>
                <span className="stat-label">Rejected</span>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Priority Beneficiaries (City-wide)</h2>
                <ul className="list">
                  <li>
                    <span>Senior Citizens</span>
                    <span className="value">{priority.senior_citizens ?? 0}</span>
                  </li>
                  <li>
                    <span>PWD</span>
                    <span className="value">{priority.pwd ?? 0}</span>
                  </li>
                  <li>
                    <span>Pregnant Women</span>
                    <span className="value">{priority.pregnant ?? 0}</span>
                  </li>
                  <li>
                    <span>Children Below 5</span>
                    <span className="value">{priority.children ?? 0}</span>
                  </li>
                </ul>
              </article>

              <article className="panel">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Situations & Routes")}>Manage Situations &amp; Routes</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Evacuation Map")}>Open Evacuation Map</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>Generate Report</button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Situations & Routes" && (
          <>
            <div className="subtabs">
              <button
                type="button"
                className={`subtab ${locationSubTab === "Situations" ? "active" : ""}`}
                onClick={() => setLocationSubTab("Situations")}
              >
                Disaster Situations
              </button>
              <button
                type="button"
                className={`subtab ${locationSubTab === "Routes" ? "active" : ""}`}
                onClick={() => setLocationSubTab("Routes")}
              >
                Evacuation Routes
              </button>
            </div>

            {locationSubTab === "Situations" && (
              <>
                <section className="panel">
                  <h2>Add a Disaster Situation</h2>
                  <form className="drrm-form" onSubmit={handleAddDisasterType}>
                    {disasterTypeFormError ? <p className="form-error">{disasterTypeFormError}</p> : null}

                    <div className="form-grid">
                      <label className="form-field form-field-wide">
                        <span className="form-label">Disaster Name</span>
                        <input
                          type="text"
                          placeholder="e.g. Typhoon Basyang 2026"
                          value={disasterTypeForm.disaster_type_name}
                          onChange={(e) => handleDisasterTypeFormChange("disaster_type_name", e.target.value)}
                          disabled={disasterTypeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">Start Date</span>
                        <input
                          type="date"
                          value={disasterTypeForm.start_date}
                          onChange={(e) => handleDisasterTypeFormChange("start_date", e.target.value)}
                          disabled={disasterTypeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">End Date</span>
                        <input
                          type="date"
                          value={disasterTypeForm.end_date}
                          onChange={(e) => handleDisasterTypeFormChange("end_date", e.target.value)}
                          disabled={disasterTypeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">Status</span>
                        <select
                          value={disasterTypeForm.status}
                          onChange={(e) => handleDisasterTypeFormChange("status", e.target.value)}
                          disabled={disasterTypeSubmitting}
                        >
                          {Object.entries(DISASTER_STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <button type="submit" className="action-btn drrm-submit-btn" disabled={disasterTypeSubmitting}>
                      {disasterTypeSubmitting ? "Adding…" : "Add Disaster Situation"}
                    </button>
                  </form>
                </section>

                <section className="panel">
                  <h2>Disaster Situations</h2>
                    <Paginated items={locationsData.disaster_types}>{(pageRows) => (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Start</th>
                          <th>End</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {locationsData.disaster_types.length > 0 ? (
                          pageRows.map((dt) => {
                            const editing = editingSituationId === dt.id;
                            return (
                              <tr key={dt.id}>
                                <td>
                                  {editing ? (
                                    <input
                                      type="text"
                                      style={{ ...CELL_INPUT_STYLE, minWidth: 180 }}
                                      value={situationDraft.disaster_type_name}
                                      onChange={(e) => setSituationDraft((d) => ({ ...d, disaster_type_name: e.target.value }))}
                                      disabled={situationSaving}
                                    />
                                  ) : (
                                    dt.name
                                  )}
                                </td>
                                <td>
                                  {editing ? (
                                    <input
                                      type="date"
                                      style={CELL_INPUT_STYLE}
                                      value={situationDraft.start_date}
                                      onChange={(e) => setSituationDraft((d) => ({ ...d, start_date: e.target.value }))}
                                      disabled={situationSaving}
                                    />
                                  ) : (
                                    formatDate(dt.start_date)
                                  )}
                                </td>
                                <td>
                                  {editing ? (
                                    <input
                                      type="date"
                                      style={CELL_INPUT_STYLE}
                                      value={situationDraft.end_date}
                                      onChange={(e) => setSituationDraft((d) => ({ ...d, end_date: e.target.value }))}
                                      disabled={situationSaving}
                                    />
                                  ) : (
                                    formatDate(dt.end_date)
                                  )}
                                </td>
                                <td>
                                  {editing ? (
                                    <select
                                      style={CELL_INPUT_STYLE}
                                      value={situationDraft.status}
                                      onChange={(e) => setSituationDraft((d) => ({ ...d, status: e.target.value }))}
                                      disabled={situationSaving}
                                    >
                                      {Object.entries(DISASTER_STATUS_LABEL).map(([value, label]) => (
                                        <option key={value} value={value}>{label}</option>
                                      ))}
                                    </select>
                                  ) : (
                                    <span className={`status-badge disaster-${dt.status}`}>
                                      {DISASTER_STATUS_LABEL[dt.status] || dt.status}
                                    </span>
                                  )}
                                </td>
                                <td>
                                  {editing ? (
                                    <div className="household-actions">
                                      <button
                                        type="button"
                                        className="btn-review"
                                        onClick={() => handleSaveSituation(dt)}
                                        disabled={situationSaving}
                                      >
                                        {situationSaving ? "Saving…" : "Save"}
                                      </button>
                                      <button
                                        type="button"
                                        className="modal-btn-cancel"
                                        onClick={cancelEditSituation}
                                        disabled={situationSaving}
                                      >
                                        Cancel
                                      </button>
                                      {situationEditError ? <p className="form-error">{situationEditError}</p> : null}
                                    </div>
                                  ) : (
                                    <div className="household-actions">
                                      <button type="button" className="btn-review" onClick={() => startEditSituation(dt)}>
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="btn-reject"
                                        onClick={() => {
                                          setSituationDeleteError("");
                                          setSituationToDelete(dt);
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="5">No disaster situations recorded yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                    )}</Paginated>
                </section>

                {situationToDelete ? (() => {
                  const linkedParts = [];
                  if (situationToDelete.donations) {
                    linkedParts.push(`${situationToDelete.donations} donation${situationToDelete.donations === 1 ? "" : "s"}`);
                  }
                  if (situationToDelete.attendance) {
                    linkedParts.push(`${situationToDelete.attendance} attendance record${situationToDelete.attendance === 1 ? "" : "s"}`);
                  }
                  const isLinked = linkedParts.length > 0;
                  return (
                    <div className="modal-overlay" onClick={() => !situationDeleting && setSituationToDelete(null)}>
                      <div className="modal-box" onClick={(e) => e.stopPropagation()}>
                        <h3>{isLinked ? "Can't delete this situation" : "Delete disaster situation?"}</h3>
                        <p>
                          {isLinked
                            ? `"${situationToDelete.name}" is linked to ${linkedParts.join(" and ")}. Deleting it would erase the disaster label from that history.${
                                situationToDelete.status === "closed" ? " It is already closed." : " Set it to Closed instead?"
                              }`
                            : `"${situationToDelete.name}" will be permanently removed. This can't be undone.`}
                        </p>
                        {situationDeleteError ? <p className="form-error">{situationDeleteError}</p> : null}
                        <div className="modal-actions">
                          <button
                            type="button"
                            className="modal-btn-cancel"
                            onClick={() => setSituationToDelete(null)}
                            disabled={situationDeleting}
                          >
                            {isLinked && situationToDelete.status === "closed" ? "OK" : "Cancel"}
                          </button>
                          {isLinked ? (
                            situationToDelete.status !== "closed" ? (
                              <button
                                type="button"
                                className="modal-btn-confirm approve"
                                onClick={handleCloseSituationInstead}
                                disabled={situationDeleting}
                              >
                                {situationDeleting ? "Closing…" : "Set to Closed"}
                              </button>
                            ) : null
                          ) : (
                            <button
                              type="button"
                              className="modal-btn-confirm reject"
                              onClick={handleDeleteSituation}
                              disabled={situationDeleting}
                            >
                              {situationDeleting ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })() : null}
              </>
            )}

            {locationSubTab === "Routes" && (
              <>
                <section className="panel">
                  <h2>Pin a Route</h2>
                  <form className="drrm-form" onSubmit={handlePinRoute}>
                    {routeFormError ? <p className="form-error">{routeFormError}</p> : null}

                    <div className="form-grid">
                      <label className="form-field">
                        <span className="form-label">Evacuation Center</span>
                        <select
                          value={routeForm.evacuation_center_id}
                          onChange={(e) => handleRouteFormChange("evacuation_center_id", e.target.value)}
                          disabled={routeSubmitting}
                        >
                          <option value="">Select a center</option>
                          {routesData.centers.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name} ({c.barangay})
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="form-field">
                        <span className="form-label">Start Location</span>
                        <input
                          type="text"
                          placeholder="e.g. Barangay Hall, Purok 3"
                          value={routeForm.start_location}
                          onChange={(e) => handleRouteFormChange("start_location", e.target.value)}
                          disabled={routeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">Distance</span>
                        <input
                          type="text"
                          placeholder="e.g. 2.4 km"
                          value={routeForm.route_distance}
                          onChange={(e) => handleRouteFormChange("route_distance", e.target.value)}
                          disabled={routeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">Estimated Time</span>
                        <input
                          type="text"
                          placeholder="e.g. 15 mins"
                          value={routeForm.estimated_time}
                          onChange={(e) => handleRouteFormChange("estimated_time", e.target.value)}
                          disabled={routeSubmitting}
                        />
                      </label>

                      <label className="form-field">
                        <span className="form-label">Road Condition</span>
                        <select
                          value={routeForm.road_condition}
                          onChange={(e) => handleRouteFormChange("road_condition", e.target.value)}
                          disabled={routeSubmitting}
                        >
                          {Object.entries(ROAD_CONDITION_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>

                      <label className="form-field">
                        <span className="form-label">Route Status</span>
                        <select
                          value={routeForm.route_status}
                          onChange={(e) => handleRouteFormChange("route_status", e.target.value)}
                          disabled={routeSubmitting}
                        >
                          {Object.entries(ROUTE_STATUS_LABEL).map(([value, label]) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <button type="submit" className="action-btn drrm-submit-btn" disabled={routeSubmitting}>
                      {routeSubmitting ? "Pinning…" : "Pin Route"}
                    </button>
                  </form>
                </section>

                <section className="panel">
                  <h2>Pinned Routes</h2>
                    <Paginated items={routesData.routes}>{(pageRows) => (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Evacuation Center</th>
                          <th>Barangay</th>
                          <th>Start Location</th>
                          <th>Distance</th>
                          <th>Est. Time</th>
                          <th>Road Condition</th>
                          <th>Status</th>
                          <th>Pinned</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routesData.routes.length > 0 ? (
                          pageRows.map((r) => (
                            <tr key={r.id}>
                              <td>{r.evacuation_center_name}</td>
                              <td>{r.barangay}</td>
                              <td>{r.start_location}</td>
                              <td>{r.route_distance || "—"}</td>
                              <td>{r.estimated_time || "—"}</td>
                              <td>
                                {editingRouteId === r.id ? (
                                  <select
                                    value={editingRoadCondition}
                                    onChange={(e) => setEditingRoadCondition(e.target.value)}
                                    disabled={routeEditSaving}
                                  >
                                    {Object.entries(ROAD_CONDITION_LABEL).map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className={`status-badge road-${r.road_condition}`}>
                                    {ROAD_CONDITION_LABEL[r.road_condition] || r.road_condition}
                                  </span>
                                )}
                              </td>
                              <td>
                                {editingRouteId === r.id ? (
                                  <select
                                    value={editingRouteStatus}
                                    onChange={(e) => setEditingRouteStatus(e.target.value)}
                                    disabled={routeEditSaving}
                                  >
                                    {Object.entries(ROUTE_STATUS_LABEL).map(([value, label]) => (
                                      <option key={value} value={value}>{label}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <span
                                    className={`status-badge route-${r.route_status}`}
                                    style={ROUTE_STATUS_STYLE[r.route_status]}
                                  >
                                    {ROUTE_STATUS_LABEL[r.route_status] || r.route_status}
                                  </span>
                                )}
                              </td>
                              <td>{r.pinned_at}</td>
                              <td>
                                {editingRouteId === r.id ? (
                                  <div className="household-actions">
                                    <button
                                      type="button"
                                      className="btn-review"
                                      onClick={() => handleSaveRouteStatus(r)}
                                      disabled={routeEditSaving}
                                    >
                                      {routeEditSaving ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      className="modal-btn-cancel"
                                      onClick={cancelEditRouteStatus}
                                      disabled={routeEditSaving}
                                    >
                                      Cancel
                                    </button>
                                    {routeEditError ? <p className="form-error">{routeEditError}</p> : null}
                                  </div>
                                ) : (
                                  <button type="button" className="btn-review" onClick={() => startEditRouteStatus(r)}>
                                    Edit
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="9">No routes have been pinned yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                    )}</Paginated>
                </section>
              </>
            )}
          </>
        )}

        {activeItem === "Evacuation Map" && <EvacuationMap onRoutesChanged={fetchRoutes} />}

        {activeItem === "Reports" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Generate Report</h2>
              <form onSubmit={handleGenerateReport} style={{ display: "grid", gap: 14 }}>
                {reportFormError && <p style={{ color: "#b42318", margin: 0 }}>{reportFormError}</p>}

                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor="report_disaster_type_id">Disaster Type</label>
                  <select
                    id="report_disaster_type_id"
                    value={reportForm.disaster_type_id}
                    onChange={(e) => handleReportFieldChange("disaster_type_id", e.target.value)}
                  >
                    <option value="">Not tied to a specific disaster</option>
                    {locationsData.disaster_types.map((dt) => (
                      <option key={dt.id} value={dt.id}>{dt.name}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor="report_title">Title</label>
                  <input
                    id="report_title"
                    type="text"
                    value={reportForm.title}
                    onChange={(e) => handleReportFieldChange("title", e.target.value)}
                    placeholder="e.g. Weekly Relief & Vulnerability Report"
                  />
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <label htmlFor="report_content">Content</label>
                  <textarea
                    id="report_content"
                    rows={5}
                    value={reportForm.content}
                    onChange={(e) => handleReportFieldChange("content", e.target.value)}
                    placeholder="Summarize the situation, relief activity, or disaster monitoring findings…"
                  />
                </div>

                <div>
                  <button type="submit" className="action-btn" disabled={isSubmittingReport}>
                    {isSubmittingReport ? "Preparing PDF…" : "Generate PDF Report"}
                  </button>
                </div>
              </form>
            </article>
          </section>
        )}

        {activeItem === "Settings" && (
          <section className="panel">
            <p className="panel-note">
              Account settings for DRRM Officers will be available here soon.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export default DRRMDashboard;