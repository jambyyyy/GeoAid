import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./PurokDashboard.css";
import Sidebar from "../../components/sidebar";
<<<<<<< HEAD
import { API_URL } from "../../config";

const navItems = ["Dashboard", "Household Registration", "Reports", "Settings"];

const sectionInfo = (barangay) => ({
  "Dashboard": { title: "Purok President Dashboard", subtitle: `Overview of household registrations awaiting your review${barangay ? ` — Brgy. ${barangay}` : ""}` },
  "Household Registration": { title: "Household Registration Review", subtitle: `Verify household submissions${barangay ? ` from Brgy. ${barangay}` : ""}, then approve to forward to Barangay Staff` },
  "Reports": { title: "Reports", subtitle: `Registration activity for ${barangay ? `Brgy. ${barangay}` : "your Purok"}` },
  "Settings": { title: "Settings", subtitle: "Manage your Purok President account preferences" },
});
=======

const navItems = ["Dashboard", "Household Registration", "Reports", "Settings"];

const sectionInfo = {
  "Dashboard": { title: "Purok President Dashboard", subtitle: "Overview of household registrations awaiting your review" },
  "Household Registration": { title: "Household Registration Review", subtitle: "Verify household submissions, then approve to forward to Barangay Staff" },
  "Reports": { title: "Reports", subtitle: "Registration activity for your Purok" },
  "Settings": { title: "Settings", subtitle: "Manage your Purok President account preferences" },
};
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca

const FLAG_CLASS = {
  "PWD": "flag-pwd",
  "4Ps": "flag-4ps",
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

const STATUS_LABEL = {
  pending: "Pending review",
  approved: "Forwarded to Barangay",
  rejected: "Info issues",
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

function MapPinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function HouseholdCard({ household, expanded, onToggle, onApprove, onReject }) {
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
            Head: {head.name} · {household.members.length} members · {household.address}
          </p>
          <p className="household-submitted">Submitted {household.submitted}</p>
        </div>

        <div className="household-actions">
          {household.status === "pending" ? (
            <>
              <button type="button" className="btn-review" onClick={() => onToggle(household.id)}>
                <ChevronIcon open={expanded} />
                {expanded ? "Collapse" : "Review"}
              </button>
              <button type="button" className="btn-approve" onClick={() => onApprove(household.id)}>
                <CheckIcon /> Approve
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
                <dt>GPS coordinates</dt>
<<<<<<< HEAD
                <dd>
                  {household.gps_lat != null && household.gps_lng != null
                    ? `${household.gps_lat.toFixed(4)}°N, ${household.gps_lng.toFixed(4)}°E`
                    : "Not pinned"}
                </dd>
              </div>
              <div className="details-row">
                <dt>Purok</dt>
                <dd>{household.purok}</dd>
              </div>
              <div className="details-row">
                <dt>Barangay</dt>
                <dd>{household.barangay}</dd>
=======
                <dd>{household.gps_lat.toFixed(4)}°N, {household.gps_lng.toFixed(4)}°E</dd>
              </div>
              <div className="details-row">
                <dt>Purok</dt>
                <dd>Purok 3</dd>
              </div>
              <div className="details-row">
                <dt>Barangay</dt>
                <dd>Tibanga, Iligan City</dd>
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
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

<<<<<<< HEAD
            {household.gps_lat != null && household.gps_lng != null && (
              <div className="mini-map">
                <div className="mini-map-pin" />
                <span className="mini-map-coord">
                  <MapPinIcon /> {household.gps_lat.toFixed(4)}°N, {household.gps_lng.toFixed(4)}°E
                </span>
              </div>
            )}
=======
            <div className="mini-map">
              <div className="mini-map-pin" />
              <span className="mini-map-coord">
                <MapPinIcon /> {household.gps_lat.toFixed(4)}°N, {household.gps_lng.toFixed(4)}°E
              </span>
            </div>
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
          </div>
        </div>
      )}
    </div>
  );
}

<<<<<<< HEAD
function ConfirmModal({ action, onConfirm, onCancel, isSubmitting }) {
  if (!action) return null;

  const isApprove = action.type === "approve";

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true">
      <div className="modal-box">
        <h3>{isApprove ? "Approve this household?" : "Reject this household?"}</h3>
        <p>
          {isApprove
            ? `${action.familyName} Family will be marked approved and forwarded to Barangay Staff for final confirmation.`
            : `${action.familyName} Family will be flagged for info issues and sent back for correction.`}
        </p>
        <div className="modal-actions">
          <button type="button" className="modal-btn-cancel" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </button>
          <button
            type="button"
            className={`modal-btn-confirm ${isApprove ? "approve" : "reject"}`}
            onClick={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? "Please wait…" : isApprove ? "Yes, Approve" : "Yes, Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

=======
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
function PurokDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "Purok President";

  const [activeItem, setActiveItem] = useState("Dashboard");
  const [dashboardData, setDashboardData] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("pending");
  const [expandedId, setExpandedId] = useState(null);
  const [toast, setToast] = useState(null);
<<<<<<< HEAD
  const [pendingAction, setPendingAction] = useState(null); // { id, type, familyName }
  const [isReviewing, setIsReviewing] = useState(false);

  // The backend resolves this account's barangay from `username` itself
  // (Django admin > Users > First Name), so no extra login-page changes
  // are needed for this to be scoped correctly.
  const barangay = dashboardData?.barangay || "";
=======
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(
<<<<<<< HEAD
          `${API_URL}/api/purok/dashboard/?username=${encodeURIComponent(username)}`
=======
          "http://127.0.0.1:8000/api/purok/dashboard/"
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
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
<<<<<<< HEAD
  }, [username]);
=======
  }, []);
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    navigate("/");
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

<<<<<<< HEAD
  // Approve/Reject require confirmation first (see ConfirmModal below),
  // then persist via POST /api/purok/households/<id>/review/ so the
  // decision survives a page refresh instead of only living in state.
  const requestApprove = (id) => {
    const h = households.find((x) => x.id === id);
    setPendingAction({ id, type: "approve", familyName: h.family_name });
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
        `${API_URL}/api/purok/households/${pendingAction.id}/review/`,
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
        pendingAction.type === "approve"
          ? `${pendingAction.familyName} Family approved and forwarded to Barangay Staff`
          : `${pendingAction.familyName} Family flagged for info issues`
      );
    } catch (err) {
      console.error(err);
      showToast("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsReviewing(false);
      setPendingAction(null);
    }
=======
  // NOTE: Approve/Reject only update local state for now — there is no
  // backend endpoint yet to persist a household's review decision.
  // Once one exists, replace this with a POST to something like
  // /api/purok/households/<id>/review/ and refresh from the response.
  const updateStatus = (id, status, message) => {
    setHouseholds((prev) => prev.map((h) => (h.id === id ? { ...h, status } : h)));
    setExpandedId(null);
    showToast(message);
  };

  const handleApprove = (id) => {
    const h = households.find((x) => x.id === id);
    updateStatus(id, "approved", `${h.family_name} Family approved and forwarded to Barangay Staff`);
  };

  const handleReject = (id) => {
    const h = households.find((x) => x.id === id);
    updateStatus(id, "rejected", `${h.family_name} Family flagged for info issues`);
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
  };

  const toggleExpand = (id) => {
    setExpandedId((current) => (current === id ? null : id));
  };

<<<<<<< HEAD
  const { title, subtitle } = sectionInfo(barangay)[activeItem];
=======
  const { title, subtitle } = sectionInfo[activeItem];
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca

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
    pending: households.filter((h) => h.status === "pending").length,
    approved: households.filter((h) => h.status === "approved").length,
    rejected: households.filter((h) => h.status === "rejected").length,
  };

  const visibleHouseholds = households.filter((h) => h.status === activeTab);

  return (
    <div className="dashboard-page">
      <Sidebar
        role="Purok President Portal"
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
            {dashboardData?.flood_advisory && (
              <span className="advisory-badge">Flood advisory active</span>
            )}
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
                <span className="stat-value">{counts.pending}</span>
                <span className="stat-label">Pending Review</span>
              </article>

              <article className="stat-card stat-success">
                <span className="stat-value">{counts.approved}</span>
                <span className="stat-label">Approved This Event</span>
              </article>

              <article className="stat-card stat-danger">
                <span className="stat-value">{counts.rejected}</span>
                <span className="stat-label">Rejected</span>
              </article>

              <article className="stat-card stat-info">
                <span className="stat-value">{dashboardData?.total_households ?? 0}</span>
                <span className="stat-label">Total {dashboardData?.purok} Households</span>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Your role</h2>
                <p className="panel-note">
                  Review household registrations from {dashboardData?.purok}, {dashboardData?.barangay}. Verify
                  that household info and member details are accurate, then approve to forward to Barangay Staff
                  for final confirmation.
                </p>
                {dashboardData?.unregistered_households > 0 && (
                  <p className="panel-note">
                    {dashboardData.unregistered_households} households in your Purok are still unregistered.
                  </p>
                )}
              </article>

              <article className="panel">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Household Registration")}>
                    Review Pending Registrations
                  </button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>
                    Generate Report
                  </button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Household Registration" && (
          <section className="panel">
            <div className="subtabs">
              {["pending", "approved", "rejected"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`subtab ${activeTab === tab ? "active" : ""}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === "pending" ? "Pending Review" : tab === "approved" ? "Approved" : "Rejected"} ({counts[tab]})
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
<<<<<<< HEAD
                  onApprove={requestApprove}
                  onReject={requestReject}
=======
                  onApprove={handleApprove}
                  onReject={handleReject}
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
                />
              ))}
            </div>
          </section>
        )}

        {activeItem === "Reports" && (
          <section className="panel">
            <p className="panel-note">
              Registration reports for {dashboardData?.purok} are not yet available from the dashboard API. Once
              connected, this section will summarize approvals, rejections, and unregistered households by week.
            </p>
          </section>
        )}

        {activeItem === "Settings" && (
          <section className="panel">
            <p className="panel-note">
              Account settings for Purok Presidents will be available here soon.
            </p>
          </section>
        )}
      </div>

      {toast && <div className="toast">{toast}</div>}
<<<<<<< HEAD
      <ConfirmModal
        action={pendingAction}
        onConfirm={confirmPendingAction}
        onCancel={cancelPendingAction}
        isSubmitting={isReviewing}
      />
=======
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
    </div>
  );
}

<<<<<<< HEAD
export default PurokDashboard;
=======
export default PurokDashboard;
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
