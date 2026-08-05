import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./PurokDashboard.css";
import Sidebar from "../../components/sidebar";

const navItems = ["Dashboard", "Household Registration", "Reports", "Settings"];

const sectionInfo = {
  "Dashboard": { title: "Purok President Dashboard", subtitle: "Overview of household registrations awaiting your review" },
  "Household Registration": { title: "Household Registration Review", subtitle: "Verify household submissions, then approve to forward to Barangay Staff" },
  "Reports": { title: "Reports", subtitle: "Registration activity for your Purok" },
  "Settings": { title: "Settings", subtitle: "Manage your Purok President account preferences" },
};

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
                <dd>{household.gps_lat.toFixed(4)}°N, {household.gps_lng.toFixed(4)}°E</dd>
              </div>
              <div className="details-row">
                <dt>Purok</dt>
                <dd>Purok 3</dd>
              </div>
              <div className="details-row">
                <dt>Barangay</dt>
                <dd>Tibanga, Iligan City</dd>
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

            <div className="mini-map">
              <div className="mini-map-pin" />
              <span className="mini-map-coord">
                <MapPinIcon /> {household.gps_lat.toFixed(4)}°N, {household.gps_lng.toFixed(4)}°E
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(
          "http://127.0.0.1:8000/api/purok/dashboard/"
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
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    navigate("/");
  };

  const showToast = (message) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

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
  };

  const toggleExpand = (id) => {
    setExpandedId((current) => (current === id ? null : id));
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
                  onApprove={handleApprove}
                  onReject={handleReject}
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
    </div>
  );
}

export default PurokDashboard;
