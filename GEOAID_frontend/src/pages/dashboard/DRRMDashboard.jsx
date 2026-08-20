import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./DRRMDashboard.css";
import Sidebar from "../../components/sidebar";
import { API_URL } from "../../config";

const navItems = ["Dashboard", "Households", "Barangay Breakdown", "Reports", "Settings"];

const sectionInfo = {
  "Dashboard": { title: "DRRM Officer Dashboard", subtitle: "City-wide disaster management & evacuation overview" },
  "Households": { title: "Confirmed Households", subtitle: "Every household that has cleared Purok President and Barangay Staff review, city-wide" },
  "Barangay Breakdown": { title: "Barangay Breakdown", subtitle: "Confirmed household registrations by barangay" },
  "Reports": { title: "Reports", subtitle: "Situation, disaster monitoring, and relief & vulnerability reports" },
  "Settings": { title: "Settings", subtitle: "Manage your DRRM Officer account preferences" },
};

const FLAG_CLASS = {
  "PWD": "flag-pwd",
  "4Ps": "flag-4ps",
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

function DRRMDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "DRRM Officer";

  const [activeItem, setActiveItem] = useState("Dashboard");
  const [dashboardData, setDashboardData] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(`${API_URL}/api/drrm/dashboard/`);
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
  const breakdown = dashboardData?.barangay_breakdown || [];
  const maxBreakdown = Math.max(1, ...breakdown.map((b) => b.households));

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
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Households")}>View Confirmed Households</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Barangay Breakdown")}>Barangay Breakdown</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>Generate Report</button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Households" && (
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Barangay</th>
                    <th>Purok</th>
                    <th>Members</th>
                    <th>Flags</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {households.length > 0 ? (
                    households.map((h) => (
                      <tr key={h.id}>
                        <td>{h.family_name} Family ({h.id})</td>
                        <td>{h.barangay}</td>
                        <td>{h.purok}</td>
                        <td>{h.members.length}</td>
                        <td>
                          {h.flags.length
                            ? h.flags.map((f) => (
                              <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`} style={{ marginRight: 4 }}>{f}</span>
                            ))
                            : "—"}
                        </td>
                        <td>{h.submitted}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="6">No confirmed households yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeItem === "Barangay Breakdown" && (
          <section className="panel">
            <div className="breakdown-list">
              {breakdown.length > 0 ? (
                breakdown.map((b) => (
                  <div key={b.barangay} className="breakdown-row">
                    <span className="breakdown-label">{b.barangay}</span>
                    <div className="breakdown-bar-track">
                      <div
                        className="breakdown-bar-fill"
                        style={{ width: `${(b.households / maxBreakdown) * 100}%` }}
                      />
                    </div>
                    <span className="breakdown-value">{b.households}</span>
                  </div>
                ))
              ) : (
                <p className="empty-state">No confirmed households yet.</p>
              )}
            </div>
          </section>
        )}

        {activeItem === "Reports" && (
          <section className="panel">
            <p className="panel-note">
              Situation, disaster monitoring, and relief & vulnerability reports aren't backed by a real
              model yet. Once connected, this section will list generated reports for city-wide review.
            </p>
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
