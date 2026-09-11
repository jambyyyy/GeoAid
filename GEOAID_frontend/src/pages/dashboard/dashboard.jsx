import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import Sidebar from "../../components/sidebar";
import { API_URL } from "../../config";

const navItems = [
  "Dashboard",
  "Household Registration",
  "Evacuation Centers",
  "Relief Distribution",
  "Attendance",
  "Reports",
];

const sectionInfo = (barangay) => ({
  "Dashboard": { title: "Barangay Staff Dashboard", subtitle: `Evacuation & Relief Operations${barangay ? ` — Brgy. ${barangay}` : ""}` },
  "Household Registration": { title: "Household Registration", subtitle: `Give final confirmation to households already approved by your Purok Presidents${barangay ? ` in Brgy. ${barangay}` : ""}` },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy and status across barangay evacuation sites" },
  "Relief Distribution": { title: "Relief Distribution", subtitle: "Track relief goods disbursed to registered households" },
  "Attendance": { title: "Evacuation Center Attendance", subtitle: "Resident check-ins confirmed via QR code scan" },
  "Reports": { title: "Reports", subtitle: "Situation, disaster monitoring, and relief & vulnerability reports" },
});

const FLAG_CLASS = {
  "PWD": "flag-pwd",
  "4Ps": "flag-4ps",
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

const STATUS_LABEL = {
  approved: "Pending your confirmation",
  confirmed: "Confirmed — visible to CSWD/DRRM",
  rejected: "Rejected",
};

const PRIORITY_CLASS = {
  High: "priority-high",
  Medium: "priority-medium",
  Low: "priority-low",
};

const REPORT_TYPE_LABELS = {
  relief_vulnerability: "Relief & Vulnerability",
  situation: "Situation",
  disaster_monitoring: "Disaster Monitoring",
};

function CheckIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M20 6 9 17l-5-5" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronIcon({ open }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "0.2s" }}
    >
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function HouseholdCard({ household, expanded, onToggle, onConfirm, onReject }) {
  const head = household.members.find((m) => m.relation === "Head") || household.members[0];

  return (
    <div className="household-card">
      <div className="household-header">
        <div className="household-avatar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="10" cy="7" r="4" stroke="currentColor" strokeWidth="1.75" />
            <path d="M17.5 3.5a4 4 0 0 1 0 7.5M22 21v-2a4 4 0 0 0-3-3.87" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
        </div>

        <div className="household-info">
          <div className="household-title-row">
            <span className="household-name">{household.family_name} Family</span>
            <span className="household-gaid">{household.id}</span>
            {household.flags.map((flag) => (
              <span key={flag} className={`flag-badge ${FLAG_CLASS[flag] || ""}`}>{flag}</span>
            ))}
          </div>
          <p className="household-meta">
            Head: {head?.name || "—"} · {household.members.length} members · {household.address}
          </p>
          <p className="household-submitted">Purok {household.purok} · Submitted {household.submitted}</p>
        </div>

        <div className="household-actions">
          {household.status === "approved" ? (
            <>
              <button type="button" className="btn-review" onClick={() => onToggle(household.id)}>
                <ChevronIcon open={expanded} />
                {expanded ? "Collapse" : "Review"}
              </button>
              <button type="button" className="btn-approve" onClick={() => onConfirm(household.id)}>
                <CheckIcon /> Confirm
              </button>
              <button type="button" className="btn-reject" onClick={() => onReject(household.id)}>
                <XIcon /> Reject
              </button>
            </>
          ) : (
            <span className={`status-pill status-pill-${household.status}`}>{STATUS_LABEL[household.status]}</span>
          )}
        </div>
      </div>

      {expanded && (
        <div className="household-body">
          <div>
            <p className="household-body-label">Family members</p>
            <div className="members-list">
              {household.members.map((m) => (
                <div key={m.name} className="member-row">
                  <div className="member-avatar">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.75" />
                      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" stroke="currentColor" strokeWidth="1.75" />
                    </svg>
                  </div>
                  <div>
                    <p className="member-name">{m.name}</p>
                    <p className="member-meta">
                      {m.relation} · Age {m.age}
                      {m.tag && <span className="member-tag"> · {m.tag}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <p className="household-body-label">Household details</p>
            <dl className="details-list">
              <div className="details-row">
                <dt>Address</dt>
                <dd>{household.address}</dd>
              </div>
              <div className="details-row">
                <dt>Purok</dt>
                <dd>{household.purok}</dd>
              </div>
              <div className="details-row">
                <dt>Barangay</dt>
                <dd>{household.barangay}</dd>
              </div>
              <div className="details-row">
                <dt>Total members</dt>
                <dd>{household.members.length} persons</dd>
              </div>
              <div className="details-row">
                <dt>Priority flags</dt>
                <dd>{household.flags.length ? household.flags.join(", ") : "None"}</dd>
              </div>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}

function ConfirmModal({ action, onConfirm, onCancel, isSubmitting }) {
  if (!action) return null;

  const isConfirm = action.type === "confirm";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <h3>{isConfirm ? "Confirm this household?" : "Reject this household?"}</h3>
        <p>
          {isConfirm
            ? `${action.familyName} Family will be marked confirmed and become visible to CSWD and DRRM.`
            : `${action.familyName} Family will be flagged for correction and sent back.`}
        </p>
        <div className="modal-actions">
          <button type="button" className="modal-btn-cancel" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className={`modal-btn-confirm ${isConfirm ? "approve" : "reject"}`}
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Please wait…" : isConfirm ? "Yes, Confirm" : "Yes, Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Dashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "Barangay Staff";
  const [activeItem, setActiveItem] = useState("Dashboard");

  const [dashboardData, setDashboardData] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [reliefForm, setReliefForm] = useState({
    household_code: "",
    goods_type: "",
    quantity: "",
    disaster_type_id: "",
    remarks: "",
  });
  const [isSubmittingRelief, setIsSubmittingRelief] = useState(false);
  const [reliefFormError, setReliefFormError] = useState("");
  const [reliefFormSuccess, setReliefFormSuccess] = useState("");

  const [reportForm, setReportForm] = useState({
    report_type: "",
    title: "",
    content: "",
    disaster_type_id: "",
  });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFormError, setReportFormError] = useState("");
  const [expandedReportId, setExpandedReportId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Evacuation center + attendance (scanned residents) — separate fetch
  // since it comes from barangay_evacuation_dashboard, not
  // barangay_dashboard. Kept optional (evacuationError, not the main
  // `error` state) so a missing EvacuationCenter doesn't block the rest
  // of the dashboard from loading.
  const [evacuationData, setEvacuationData] = useState(null);
  const [evacuationError, setEvacuationError] = useState("");

  const [activeTab, setActiveTab] = useState("approved");
  const [expandedId, setExpandedId] = useState(null);
  const [attendancePage, setAttendancePage] = useState(1);
  const ATTENDANCE_PAGE_SIZE = 10;
  const [expandedAttendanceHousehold, setExpandedAttendanceHousehold] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { id, type, familyName }
  const [isReviewing, setIsReviewing] = useState(false);

  // Resolved server-side from this account's First Name (Django admin >
  // Users), same convention Purok President dashboards use.
  const barangay = dashboardData?.barangay || "";

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/barangay/dashboard/?username=${encodeURIComponent(username)}`
        );

        const data = await response.json();

        setDashboardData(data);
        setHouseholds(data.households || []);
      } catch (err) {
        console.error(err);
        setError("Failed to load dashboard data.");
      } finally {
        setLoading(false);
      }
    };

    fetchDashboard();
  }, [username]);

  useEffect(() => {
    const fetchEvacuation = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/barangay/evacuation/dashboard/?username=${encodeURIComponent(username)}`
        );
        const data = await response.json();

        if (!response.ok) {
          // Backend returns a helpful { message } here (e.g. "No
          // evacuation center is set up yet for X") — surface it instead
          // of silently showing an empty table.
          setEvacuationError(data.message || "Could not load evacuation center data.");
          return;
        }

        setEvacuationData(data);
        setEvacuationError("");
      } catch (err) {
        console.error(err);
        setEvacuationError("Unable to connect to the server.");
      }
    };

    fetchEvacuation();
  }, [username]);

  useEffect(() => {
    setAttendancePage(1);
    setExpandedAttendanceHousehold(null);
  }, [evacuationData]);

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    navigate("/");
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const requestConfirm = (id) => {
    const h = households.find((x) => x.id === id);
    setPendingAction({ id, type: "confirm", familyName: h.family_name });
  };

  const requestReject = (id) => {
    const h = households.find((x) => x.id === id);
    setPendingAction({ id, type: "reject", familyName: h.family_name });
  };

  const cancelPendingAction = () => {
    if (isReviewing) return;
    setPendingAction(null);
  };

  const confirmPendingAction = async () => {
    if (!pendingAction) return;
    setIsReviewing(true);

    try {
      const response = await fetch(
        `${API_URL}/api/barangay/households/${pendingAction.id}/confirm/`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: pendingAction.type, username }),
        }
      );

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        showToast(data.message || "Could not update this household. Please try again.");
        return;
      }

      setHouseholds((prev) =>
        prev.map((h) => (h.id === pendingAction.id ? { ...h, status: data.status } : h))
      );
      setExpandedId(null);
      showToast(
        pendingAction.type === "confirm"
          ? `${pendingAction.familyName} Family confirmed and forwarded to CSWD/DRRM`
          : `${pendingAction.familyName} Family flagged for correction`
      );
    } catch (err) {
      console.error(err);
      showToast("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsReviewing(false);
      setPendingAction(null);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId((current) => (current === id ? null : id));
  };

  const handleReliefFieldChange = (field, value) => {
    setReliefForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleRecordRelief = async (e) => {
    e.preventDefault();
    setReliefFormError("");
    setReliefFormSuccess("");

    if (!reliefForm.household_code || !reliefForm.goods_type.trim() || !reliefForm.quantity) {
      setReliefFormError("Household, goods type, and quantity are required.");
      return;
    }

    setIsSubmittingRelief(true);
    try {
      const response = await fetch(`${API_URL}/api/barangay/relief/record/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reliefForm, username }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setReliefFormError(data.message || "Could not record this relief release. Please try again.");
        return;
      }

      // Update this household in place so the checklist reflects
      // "Relief Given" immediately, without a full dashboard refetch.
      setHouseholds((prev) =>
        prev.map((h) =>
          h.id === data.relief.household_code
            ? {
                ...h,
                relief_status: "Relief Given",
                relief_count: (h.relief_count || 0) + 1,
                relief_last_goods: data.relief.goods_type,
                relief_last_quantity: data.relief.quantity,
                relief_last_date: data.relief.distributed_at,
              }
            : h
        )
      );

      setReliefFormSuccess(`Logged ${data.relief.quantity} ${data.relief.goods_type} for ${data.relief.household_code}.`);
      setReliefForm({
        household_code: "",
        goods_type: "",
        quantity: "",
        disaster_type_id: "",
        remarks: "",
      });
    } catch (err) {
      console.error(err);
      setReliefFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingRelief(false);
    }
  };

  const handleReportFieldChange = (field, value) => {
    setReportForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleGenerateReport = async (e) => {
    e.preventDefault();
    setReportFormError("");

    if (!reportForm.report_type || !reportForm.title.trim() || !reportForm.content.trim()) {
      setReportFormError("Report type, title, and content are required.");
      return;
    }

    setIsSubmittingReport(true);
    try {
      const response = await fetch(`${API_URL}/api/reports/generate/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reportForm, username }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setReportFormError(data.message || "Could not generate this report. Please try again.");
        return;
      }

      setDashboardData((prev) =>
        prev ? { ...prev, reports: [data.report, ...(prev.reports || [])] } : prev
      );
      setReportForm({ report_type: "", title: "", content: "", disaster_type_id: "" });
    } catch (err) {
      console.error(err);
      setReportFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingReport(false);
    }
  };

  const { title, subtitle } = sectionInfo(barangay)[activeItem];

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

  const counts = {
    approved: households.filter((h) => h.status === "approved").length,
    confirmed: households.filter((h) => h.status === "confirmed").length,
    rejected: households.filter((h) => h.status === "rejected").length,
  };

  const visibleHouseholds = households.filter((h) => h.status === activeTab);
  // Only confirmed households are eligible beneficiaries — matches the
  // same rule the CSWD dashboard's Relief Distribution tab uses, since
  // "approved" households haven't been confirmed by this barangay yet.
  const confirmedHouseholds = households.filter((h) => h.status === "confirmed");

  return (
    <div className="dashboard-page">
      <Sidebar
        role="Barangay Staff Portal"
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
              <article className="stat-card stat-warning">
                <span className="stat-value">{counts.approved}</span>
                <span className="stat-label">Pending Your Confirmation</span>
              </article>
              <article className="stat-card stat-success">
                <span className="stat-value">{counts.confirmed}</span>
                <span className="stat-label">Confirmed Households</span>
              </article>
              <article className="stat-card stat-danger">
                <span className="stat-value">{counts.rejected}</span>
                <span className="stat-label">Rejected</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{dashboardData?.unregistered_households ?? 0}</span>
                <span className="stat-label">Unregistered in {barangay || "Barangay"}</span>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Your role</h2>
                <p className="panel-note">
                  Give final confirmation to household registrations already reviewed and approved by their Purok
                  President{barangay ? ` in Brgy. ${barangay}` : ""}. Once confirmed, a household becomes visible
                  city-wide to CSWD and DRRM Officers.
                </p>
                {counts.approved > 0 && (
                  <p className="panel-note">
                    {counts.approved} household{counts.approved === 1 ? "" : "s"} awaiting your confirmation right now.
                  </p>
                )}
              </article>

              <article className="panel">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Household Registration")}>Confirm Registration</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Attendance")}>Scan QR Code</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Evacuation Centers")}>Update Occupancy</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Relief Distribution")}>Record Relief Distribution</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Attendance")}>View Checked-In Households</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>Generate Report</button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Household Registration" && (
          <section className="panel">
            <div className="subtabs">
              {["approved", "confirmed", "rejected"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`subtab ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "approved" ? "Pending Confirmation" : tab === "confirmed" ? "Confirmed" : "Rejected"} ({counts[tab]})
                </button>
              ))}
            </div>

            <div className="household-list">
              {visibleHouseholds.length === 0 && (
                <p className="empty-state">No households in this list yet.</p>
              )}
              {visibleHouseholds.map((h) => (
                <HouseholdCard
                  key={h.id}
                  household={h}
                  expanded={expandedId === h.id}
                  onToggle={toggleExpand}
                  onConfirm={requestConfirm}
                  onReject={requestReject}
                />
              ))}
            </div>
          </section>
        )}

        {activeItem === "Evacuation Centers" && (
          <section className="panel">
            {evacuationError ? (
              <p className="empty-state">{evacuationError}</p>
            ) : !evacuationData?.evacuation_centers?.length ? (
              <p className="empty-state">Loading evacuation center data…</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Center Name</th>
                      <th>Barangay</th>
                      <th>Capacity</th>
                      <th>Occupancy</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evacuationData.evacuation_centers.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.barangay}</td>
                        <td>{c.capacity}</td>
                        <td>{c.occupancy} / {c.capacity}</td>
                        <td><span className={`status-badge status-${c.status}`}>{c.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {activeItem === "Relief Distribution" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Record Relief Distribution</h2>
              <form className="donation-form" onSubmit={handleRecordRelief}>
                {reliefFormError && <p className="donation-form-error">{reliefFormError}</p>}
                {reliefFormSuccess && <p className="panel-note">{reliefFormSuccess}</p>}

                <div className="donation-form-field">
                  <label htmlFor="relief_household_code">Household</label>
                  <select
                    id="relief_household_code"
                    value={reliefForm.household_code}
                    onChange={(e) => handleReliefFieldChange("household_code", e.target.value)}
                  >
                    <option value="">Select a confirmed household</option>
                    {confirmedHouseholds.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.family_name} Family ({h.id})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_goods_type">Goods Type</label>
                  <input
                    id="relief_goods_type"
                    type="text"
                    value={reliefForm.goods_type}
                    onChange={(e) => handleReliefFieldChange("goods_type", e.target.value)}
                    placeholder="e.g. Rice, canned goods, hygiene kit"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_quantity">Quantity</label>
                  <input
                    id="relief_quantity"
                    type="number"
                    min="0"
                    value={reliefForm.quantity}
                    onChange={(e) => handleReliefFieldChange("quantity", e.target.value)}
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_disaster_type_id">Disaster Type</label>
                  <select
                    id="relief_disaster_type_id"
                    value={reliefForm.disaster_type_id}
                    onChange={(e) => handleReliefFieldChange("disaster_type_id", e.target.value)}
                  >
                    <option value="">Not tied to a specific disaster</option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={dt.id}>
                        {dt.name}{dt.status === "closed" ? " (Closed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_remarks">Remarks (optional)</label>
                  <input
                    id="relief_remarks"
                    type="text"
                    value={reliefForm.remarks}
                    onChange={(e) => handleReliefFieldChange("remarks", e.target.value)}
                    placeholder="e.g. Picked up by household head"
                  />
                </div>

                <div className="donation-form-actions">
                  <button type="submit" className="action-btn" disabled={isSubmittingRelief}>
                    {isSubmittingRelief ? "Saving…" : "Record Relief Release"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel">
              <h2>Beneficiary Checklist</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Household</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Last Relief Given</th>
                    </tr>
                  </thead>
                  <tbody>
                    {confirmedHouseholds.length > 0 ? (
                      confirmedHouseholds.map((h) => (
                        <tr key={h.id}>
                          <td>{h.family_name} Family ({h.id})</td>
                          <td>
                            <span className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}>
                              {h.priority_level || "Low"}
                            </span>
                          </td>
                          <td>
                            <span className={`status-badge status-${String(h.relief_status).toLowerCase().replace(/\s+/g, "-")}`}>
                              {h.relief_status}
                            </span>
                          </td>
                          <td>
                            {h.relief_last_goods
                              ? `${h.relief_last_quantity}x ${h.relief_last_goods} · ${h.relief_last_date}`
                              : "—"}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4">No confirmed households in {barangay || "this barangay"} yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeItem === "Attendance" && (
          <section className="panel">
            {evacuationError ? (
              <p className="empty-state">{evacuationError}</p>
            ) : (evacuationData?.attendance_records || []).length === 0 ? (
              <p className="empty-state">No residents have checked in yet.</p>
            ) : (
              (() => {
                // Group the flat scan-event list (one row per check-in AND
                // per check-out — the same person checking in and out
                // repeatedly is what made this table so long) into one
                // row per household, with a "View Records" toggle to see
                // that household's individual scan history underneath.
                const groups = [];
                const groupsByHousehold = {};
                for (const a of evacuationData.attendance_records) {
                  let group = groupsByHousehold[a.household];
                  if (!group) {
                    group = { household: a.household, center: a.center, records: [] };
                    groupsByHousehold[a.household] = group;
                    groups.push(group);
                  }
                  group.records.push(a);
                }
                // Records already arrive sorted newest-first overall, so
                // each group's records (and therefore group.records[0],
                // used below) are already newest-first too — no
                // re-sorting needed.

                const totalPages = Math.max(1, Math.ceil(groups.length / ATTENDANCE_PAGE_SIZE));
                const page = Math.min(attendancePage, totalPages);
                const start = (page - 1) * ATTENDANCE_PAGE_SIZE;
                const pageGroups = groups.slice(start, start + ATTENDANCE_PAGE_SIZE);

                return (
                  <>
                    <div className="table-scroll">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Household</th>
                            <th>Evacuation Center</th>
                            <th>Status</th>
                            <th>Last Activity</th>
                            <th>Total Visits</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {pageGroups.map((group) => {
                            const presentCount = group.records.filter((r) => r.status === "present").length;
                            const latest = group.records[0];
                            const isExpanded = expandedAttendanceHousehold === group.household;

                            return (
                              <Fragment key={group.household}>
                                <tr>
                                  <td>{group.household}</td>
                                  <td>{group.center}</td>
                                  <td>
                                    <span className={`status-badge status-${presentCount > 0 ? "present" : "checked-out"}`}>
                                      {presentCount > 0
                                        ? `${presentCount} Present`
                                        : "All Checked Out"}
                                    </span>
                                  </td>
                                  <td>
                                    {latest.status === "present"
                                      ? `Checked in ${latest.checkIn}`
                                      : `Checked out ${latest.checkOut}`}
                                  </td>
                                  <td>{group.records.length}</td>
                                  <td>
                                    <button
                                      type="button"
                                      className="action-btn"
                                      onClick={() =>
                                        setExpandedAttendanceHousehold(isExpanded ? null : group.household)
                                      }
                                    >
                                      {isExpanded ? "Hide Records" : "View Records"}
                                    </button>
                                  </td>
                                </tr>
                                {isExpanded && (
                                  <tr>
                                    <td colSpan="6">
                                      <table className="data-table">
                                        <thead>
                                          <tr>
                                            <th>Resident</th>
                                            <th>Disaster Type</th>
                                            <th>Check-In</th>
                                            <th>Check-Out</th>
                                            <th>Status</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {group.records.map((a, i) => (
                                            <tr key={`${a.resident}-${a.checkIn}-${i}`}>
                                              <td>{a.resident}</td>
                                              <td>{a.disasterType || "—"}</td>
                                              <td>{a.checkIn}</td>
                                              <td>{a.checkOut}</td>
                                              <td>
                                                <span className={`status-badge status-${a.status}`}>
                                                  {a.status === "present" ? "Present" : "Checked Out"}
                                                </span>
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </td>
                                  </tr>
                                )}
                              </Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>

                    {totalPages > 1 && (
                      <div className="pagination">
                        <button
                          type="button"
                          className="pagination-btn"
                          onClick={() => setAttendancePage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                        >
                          Previous
                        </button>
                        <span className="pagination-info">
                          Page {page} of {totalPages}
                        </span>
                        <button
                          type="button"
                          className="pagination-btn"
                          onClick={() => setAttendancePage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                );
              })()
            )}
          </section>
        )}

        {activeItem === "Reports" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Generate Report</h2>
              <form className="donation-form" onSubmit={handleGenerateReport}>
                {reportFormError && <p className="donation-form-error">{reportFormError}</p>}

                <div className="donation-form-field">
                  <label htmlFor="report_type">Report Type</label>
                  <select
                    id="report_type"
                    value={reportForm.report_type}
                    onChange={(e) => handleReportFieldChange("report_type", e.target.value)}
                  >
                    <option value="">Select a report type</option>
                    {Object.entries(REPORT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="report_disaster_type_id">Disaster Type</label>
                  <select
                    id="report_disaster_type_id"
                    value={reportForm.disaster_type_id}
                    onChange={(e) => handleReportFieldChange("disaster_type_id", e.target.value)}
                  >
                    <option value="">Not tied to a specific disaster</option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={dt.id}>
                        {dt.name}{dt.status === "closed" ? " (Closed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="report_title">Title</label>
                  <input
                    id="report_title"
                    type="text"
                    value={reportForm.title}
                    onChange={(e) => handleReportFieldChange("title", e.target.value)}
                    placeholder="e.g. Situation Report — Flood Watch, Poblacion"
                  />
                </div>

                <div className="donation-form-field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="report_content">Content</label>
                  <textarea
                    id="report_content"
                    rows={5}
                    value={reportForm.content}
                    onChange={(e) => handleReportFieldChange("content", e.target.value)}
                    placeholder="Summarize the situation, relief activity, or disaster monitoring findings…"
                  />
                </div>

                <div className="donation-form-actions">
                  <button type="submit" className="action-btn" disabled={isSubmittingReport}>
                    {isSubmittingReport ? "Saving…" : "Generate Report"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel">
              <h2>Generated Reports</h2>
              <ul className="reports-list">
                {(dashboardData?.reports || []).length === 0 && (
                  <p className="empty-state">No reports generated yet.</p>
                )}
                {(dashboardData?.reports || []).map((r) => {
                  const isExpanded = expandedReportId === r.id;
                  return (
                    <li key={r.id} onClick={() => setExpandedReportId(isExpanded ? null : r.id)} style={{ cursor: "pointer", flexDirection: "column", alignItems: "stretch" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", width: "100%" }}>
                        <div>
                          <p className="report-title">{r.title}</p>
                          <span className="report-date">
                            {r.date}{r.generated_by ? ` · ${r.generated_by}` : ""}{r.disaster_type ? ` · ${r.disaster_type}` : ""}
                          </span>
                        </div>
                        <span className={`activity-type type-${r.type === "situation" ? "alert" : r.type === "disaster_monitoring" ? "dispatch" : "report"}`}>
                          {REPORT_TYPE_LABELS[r.type] || r.type}
                        </span>
                      </div>
                      {isExpanded && <p className="panel-note" style={{ marginTop: "10px" }}>{r.content}</p>}
                    </li>
                  );
                })}
              </ul>
            </article>
          </section>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
      <ConfirmModal
        action={pendingAction}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
        isSubmitting={isReviewing}
      />
    </div>
  );
}

export default Dashboard;