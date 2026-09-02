import { useEffect, useState } from "react";
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

// --- Static placeholders (no backing model yet) ---
const evacuationCenters = [
  { name: "Poblacion Elementary School", address: "Brgy. Poblacion", capacity: 300, occupancy: 142, status: "open" },
  { name: "Brgy. Hinaplanon Covered Court", address: "Brgy. Hinaplanon", capacity: 150, occupancy: 150, status: "full" },
  { name: "San Roque Barangay Hall", address: "Brgy. San Roque", capacity: 120, occupancy: 40, status: "open" },
  { name: "Tibanga National High School", address: "Brgy. Tibanga", capacity: 200, occupancy: 0, status: "closed" },
];

const reliefDistribution = [
  { household: "Maria Dela Cruz", quantityGiven: 1, date: "Jul 12, 2026", trackingNo: "RD-1042", status: "claimed" },
  { household: "Elena Bautista", quantityGiven: 1, date: "Jul 12, 2026", trackingNo: "RD-1043", status: "claimed" },
  { household: "Corazon Ibanez", quantityGiven: 1, date: "Jul 13, 2026", trackingNo: "RD-1044", status: "pending" },
  { household: "Jomar Villareal", quantityGiven: 1, date: "Jul 13, 2026", trackingNo: "RD-1045", status: "unclaimed" },
];

const reports = [
  { title: "Weekly Relief & Vulnerability Report", type: "relief_vulnerability", date: "Jul 13, 2026" },
  { title: "Situation Report — Flood Watch, Poblacion", type: "situation", date: "Jul 12, 2026" },
  { title: "Disaster Monitoring Summary — Week 28", type: "disaster_monitoring", date: "Jul 11, 2026" },
];

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
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Center Name</th>
                    <th>Address</th>
                    <th>Capacity</th>
                    <th>Occupancy</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {evacuationCenters.map((c) => (
                    <tr key={c.name}>
                      <td>{c.name}</td>
                      <td>{c.address}</td>
                      <td>{c.capacity}</td>
                      <td>{c.occupancy} / {c.capacity}</td>
                      <td><span className={`status-badge status-${c.status}`}>{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel-note">Evacuation center data isn't backed by a real model yet — shown for layout only.</p>
          </section>
        )}

        {activeItem === "Relief Distribution" && (
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Quantity Given</th>
                    <th>Distribution Date</th>
                    <th>Tracking No.</th>
                    <th>Claim Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reliefDistribution.map((r) => (
                    <tr key={r.trackingNo}>
                      <td>{r.household}</td>
                      <td>{r.quantityGiven}</td>
                      <td>{r.date}</td>
                      <td>{r.trackingNo}</td>
                      <td><span className={`status-badge status-${r.status}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="panel-note">Relief distribution data isn't backed by a real model yet — shown for layout only.</p>
          </section>
        )}

        {activeItem === "Attendance" && (
          <section className="panel">
            {evacuationError ? (
              <p className="empty-state">{evacuationError}</p>
            ) : (evacuationData?.attendance_records || []).length === 0 ? (
              <p className="empty-state">No residents have checked in yet.</p>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Resident</th>
                      <th>Household</th>
                      <th>Evacuation Center</th>
                      <th>Check-In</th>
                      <th>Check-Out</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evacuationData.attendance_records.map((a, i) => (
                      <tr key={`${a.resident}-${a.checkIn}-${i}`}>
                        <td>{a.resident}</td>
                        <td>{a.household}</td>
                        <td>{a.center}</td>
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
              </div>
            )}
          </section>
        )}

        {activeItem === "Reports" && (
          <section className="panel">
            <ul className="reports-list">
              {reports.map((r) => (
                <li key={r.title}>
                  <div>
                    <p className="report-title">{r.title}</p>
                    <span className="report-date">{r.date}</span>
                  </div>
                  <span className={`activity-type type-${r.type === "situation" ? "alert" : r.type === "disaster_monitoring" ? "dispatch" : "report"}`}>
                    {r.type.replace("_", " ")}
                  </span>
                </li>
              ))}
            </ul>
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