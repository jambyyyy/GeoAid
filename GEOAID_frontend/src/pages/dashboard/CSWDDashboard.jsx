import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./CSWDDashboard.css";
import Sidebar from "../../components/sidebar";
import { API_URL } from "../../config";

const navItems = [
  "Dashboard",
  "Relief Distribution",
  "Priority Beneficiaries",
  "Households",
  "Vulnerability Profiles",
  "Evacuation Centers",
  "Donations",
  "Reports",
  "Settings",
];

const FLAG_CLASS = {
  "PWD": "flag-pwd",
  "4Ps": "flag-4ps",
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

const sectionInfo = {
  "Dashboard": { title: "CSWD Dashboard", subtitle: "City Social Welfare & Development — Relief & Beneficiary Operations" },
  "Relief Distribution": { title: "Relief Distribution", subtitle: "Track relief goods disbursed across barangays" },
  "Priority Beneficiaries": { title: "Priority Beneficiaries", subtitle: "Senior citizens, PWD, pregnant women, and children under 5" },
  "Households": { title: "Households", subtitle: "Registered households under CSWD monitoring" },
  "Vulnerability Profiles": { title: "Vulnerability Profiles", subtitle: "Household vulnerability assessments and risk classification" },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy across active evacuation sites" },
  "Donations": { title: "Donations", subtitle: "Inventory of donated goods available for distribution" },
  "Reports": { title: "Reports", subtitle: "Relief, vulnerability, and situation reports" },
  "Settings": { title: "Settings", subtitle: "Manage your CSWD account preferences" },
};

// Static donation inventory (not yet part of the dashboard API response)
const donationInventory = [
  { item: "Rice Packs", quantity: "1,200" },
  { item: "Water Bottles", quantity: "3,500" },
  { item: "Canned Goods", quantity: "2,700" },
  { item: "Blankets", quantity: "400" },
];

// Static reports list (not yet part of the dashboard API response)
const reports = [
  { title: "Weekly Relief & Vulnerability Report", type: "relief_vulnerability", date: "Jul 13, 2026" },
  { title: "Priority Beneficiaries Summary", type: "relief_vulnerability", date: "Jul 12, 2026" },
  { title: "Evacuation Center Occupancy Report", type: "situation", date: "Jul 11, 2026" },
  { title: "Donation Inventory Summary", type: "disaster_monitoring", date: "Jul 10, 2026" },
];

function CSWDDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "CSWD Personnel";

  const [activeItem, setActiveItem] = useState("Dashboard");
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/cswd/dashboard/`
        );

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

  const priorityBeneficiaries = dashboardData?.priority_beneficiaries || {};
  const reliefDistribution = dashboardData?.relief_distribution || [];
  const evacuationCenters = dashboardData?.evacuation_centers || [];

  return (
    <div className="dashboard-page">
      <Sidebar
        role="CSWD Panel"
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
              <article className="stat-card stat-info">
                <span className="stat-value">{dashboardData?.total_households ?? 0}</span>
                <span className="stat-label">Total Households</span>
              </article>

              <article className="stat-card stat-danger">
                <span className="stat-value">{dashboardData?.priority_cases ?? 0}</span>
                <span className="stat-label">Priority Cases</span>
              </article>

              <article className="stat-card stat-success">
                <span className="stat-value">{dashboardData?.relief_released ?? 0}</span>
                <span className="stat-label">Relief Released</span>
              </article>

              <article className="stat-card stat-warning">
                <span className="stat-value">₱{dashboardData?.donations ?? 0}</span>
                <span className="stat-label">Donations</span>
              </article>
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Relief Distribution Overview</h2>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Barangay</th>
                        <th>Families</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reliefDistribution.length > 0 ? (
                        reliefDistribution.map((item, index) => (
                          <tr key={index}>
                            <td>{item.barangay}</td>
                            <td>{item.families}</td>
                            <td>
                              <span className={`status-badge status-${String(item.status).toLowerCase().replace(/\s+/g, "-")}`}>
                                {item.status}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="3">No relief distribution records yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="panel">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Relief Distribution")}>Record Relief Distribution</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Priority Beneficiaries")}>Review Priority Cases</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Households")}>View Households</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Vulnerability Profiles")}>Update Vulnerability Profile</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Evacuation Centers")}>Check Evacuation Centers</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>Generate Report</button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Relief Distribution" && (
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Barangay</th>
                    <th>Families</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reliefDistribution.length > 0 ? (
                    reliefDistribution.map((item, index) => (
                      <tr key={index}>
                        <td>{item.barangay}</td>
                        <td>{item.families}</td>
                        <td>
                          <span className={`status-badge status-${String(item.status).toLowerCase().replace(/\s+/g, "-")}`}>
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="3">No relief distribution records yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeItem === "Priority Beneficiaries" && (
          <section className="panel">
            <ul className="list">
              <li>
                <span>Senior Citizens</span>
                <span className="value">{priorityBeneficiaries.senior_citizens ?? 0}</span>
              </li>
              <li>
                <span>PWD</span>
                <span className="value">{priorityBeneficiaries.pwd ?? 0}</span>
              </li>
              <li>
                <span>Pregnant Women</span>
                <span className="value">{priorityBeneficiaries.pregnant ?? 0}</span>
              </li>
              <li>
                <span>Children Below 5</span>
                <span className="value">{priorityBeneficiaries.children ?? 0}</span>
              </li>
            </ul>
          </section>
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
                  {(dashboardData?.households || []).length > 0 ? (
                    dashboardData.households.map((h) => (
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

        {activeItem === "Vulnerability Profiles" && (
          <section className="panel">
            <p className="panel-note">
              Vulnerability assessment profiles are not yet available from the dashboard API. This section
              will show household risk classifications (low, medium, high) once that data is connected.
            </p>
          </section>
        )}

        {activeItem === "Evacuation Centers" && (
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Center</th>
                    <th>Occupancy</th>
                  </tr>
                </thead>
                <tbody>
                  {evacuationCenters.length > 0 ? (
                    evacuationCenters.map((center, index) => (
                      <tr key={index}>
                        <td>{center.name}</td>
                        <td>{center.occupancy}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="2">No evacuation center data yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeItem === "Donations" && (
          <section className="panel">
            <ul className="list">
              {donationInventory.map((entry) => (
                <li key={entry.item}>
                  <span>{entry.item}</span>
                  <span className="value">{entry.quantity}</span>
                </li>
              ))}
            </ul>
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

        {activeItem === "Settings" && (
          <section className="panel">
            <p className="panel-note">
              Account settings for CSWD personnel will be available here soon.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export default CSWDDashboard;