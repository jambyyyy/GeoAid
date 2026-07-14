import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import Sidebar from "../../components/sidebar";

const navItems = [
  "Dashboard",
  "Household Registration",
  "Evacuation Centers",
  "Relief Distribution",
  "Attendance",
  "Reports",
];

// --- Dashboard overview data ---
const stats = [
  { label: "Pending Registrations", value: "9", tone: "danger" },
  { label: "Center Occupancy", value: "142/300", tone: "warning" },
  { label: "Checked-In Households", value: "58", tone: "info" },
  { label: "Relief Claims Processed", value: "31", tone: "success" },
];

const recentActivity = [
  { time: "10:32 AM", event: "Household #0231 (Purok 4) registration confirmed and forwarded to CSWD", type: "report" },
  { time: "09:50 AM", event: "QR code scanned — Familia Dela Cruz checked in at Poblacion Elementary Evac. Center", type: "update" },
  { time: "09:15 AM", event: "Evacuation center occupancy updated: 142/300 at Poblacion Elementary", type: "dispatch" },
  { time: "08:40 AM", event: "3 pending household registrations awaiting Purok President verification", type: "alert" },
  { time: "07:55 AM", event: "Relief goods disbursement recorded for 12 households — Tracking No. RD-1042", type: "report" },
];

// --- Household table (matches household + confirmation_status from the Data Dictionary) ---
const households = [
  { id: "HH-0231", representative: "Maria Dela Cruz", purok: "Purok 4", registrationYear: 2026, status: "confirmed" },
  { id: "HH-0232", representative: "Ronaldo Sarmiento", purok: "Purok 2", registrationYear: 2026, status: "pending" },
  { id: "HH-0233", representative: "Elena Bautista", purok: "Purok 7", registrationYear: 2026, status: "confirmed" },
  { id: "HH-0234", representative: "Jomar Villareal", purok: "Purok 1", registrationYear: 2026, status: "pending" },
  { id: "HH-0235", representative: "Corazon Ibanez", purok: "Purok 3", registrationYear: 2026, status: "rejected" },
  { id: "HH-0236", representative: "Danilo Fernandez", purok: "Purok 5", registrationYear: 2026, status: "pending" },
];

// --- Evacuation centers (matches evacuation_center table) ---
const evacuationCenters = [
  { name: "Poblacion Elementary School", address: "Brgy. Poblacion", capacity: 300, occupancy: 142, status: "open" },
  { name: "Brgy. Hinaplanon Covered Court", address: "Brgy. Hinaplanon", capacity: 150, occupancy: 150, status: "full" },
  { name: "San Roque Barangay Hall", address: "Brgy. San Roque", capacity: 120, occupancy: 40, status: "open" },
  { name: "Tibanga National High School", address: "Brgy. Tibanga", capacity: 200, occupancy: 0, status: "closed" },
];

// --- Relief distribution (matches relief_distribution table) ---
const reliefDistribution = [
  { household: "Maria Dela Cruz", quantityGiven: 1, date: "Jul 12, 2026", trackingNo: "RD-1042", status: "claimed" },
  { household: "Elena Bautista", quantityGiven: 1, date: "Jul 12, 2026", trackingNo: "RD-1043", status: "claimed" },
  { household: "Corazon Ibanez", quantityGiven: 1, date: "Jul 13, 2026", trackingNo: "RD-1044", status: "pending" },
  { household: "Jomar Villareal", quantityGiven: 1, date: "Jul 13, 2026", trackingNo: "RD-1045", status: "unclaimed" },
];

// --- Attendance (matches attendance table — one row per resident QR check-in) ---
const attendanceRecords = [
  { resident: "Maria Dela Cruz", household: "Dela Cruz Household", center: "Poblacion Elementary", checkIn: "07:42 AM", checkOut: "—", status: "present" },
  { resident: "Juan Dela Cruz", household: "Dela Cruz Household", center: "Poblacion Elementary", checkIn: "07:42 AM", checkOut: "—", status: "present" },
  { resident: "Ronaldo Sarmiento", household: "Sarmiento Household", center: "Poblacion Elementary", checkIn: "08:05 AM", checkOut: "—", status: "present" },
  { resident: "Liza Sarmiento", household: "Sarmiento Household", center: "Poblacion Elementary", checkIn: "08:05 AM", checkOut: "—", status: "present" },
  { resident: "Elena Bautista", household: "Bautista Household", center: "Brgy. Hinaplanon Covered Court", checkIn: "06:58 AM", checkOut: "11:20 AM", status: "checked-out" },
  { resident: "Corazon Ibanez", household: "Ibanez Household", center: "Brgy. Hinaplanon Covered Court", checkIn: "07:15 AM", checkOut: "—", status: "present" },
];

// --- Reports (matches report table — report_type enum) ---
const reports = [
  { title: "Weekly Relief & Vulnerability Report", type: "relief_vulnerability", date: "Jul 13, 2026" },
  { title: "Situation Report — Flood Watch, Poblacion", type: "situation", date: "Jul 12, 2026" },
  { title: "Disaster Monitoring Summary — Week 28", type: "disaster_monitoring", date: "Jul 11, 2026" },
  { title: "Situation Report — Evacuation Center Occupancy", type: "situation", date: "Jul 10, 2026" },
];

function Dashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "Barangay Staff";
  const [activeItem, setActiveItem] = useState("Dashboard");

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    navigate("/");
  };

  const sectionInfo = {
    "Dashboard": { title: "Barangay Staff Dashboard", subtitle: "Barangay Poblacion — Evacuation & Relief Operations" },
    "Household Registration": { title: "Household Registration", subtitle: "Verify and confirm household records submitted by residents" },
    "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy and status across barangay evacuation sites" },
    "Relief Distribution": { title: "Relief Distribution", subtitle: "Track relief goods disbursed to registered households" },
    "Attendance": { title: "Evacuation Center Attendance", subtitle: "Resident check-ins confirmed via QR code scan" },
    "Reports": { title: "Reports", subtitle: "Situation, disaster monitoring, and relief & vulnerability reports" },
  };

  const { title, subtitle } = sectionInfo[activeItem];

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
              {stats.map((stat) => (
                <article key={stat.label} className={`stat-card stat-${stat.tone}`}>
                  <span className="stat-value">{stat.value}</span>
                  <span className="stat-label">{stat.label}</span>
                </article>
              ))}
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Recent Activity</h2>
                <ul className="activity-list">
                  {recentActivity.map((item) => (
                    <li key={item.time + item.event}>
                      <span className="activity-time">{item.time}</span>
                      <div>
                        <p>{item.event}</p>
                        <span className={`activity-type type-${item.type}`}>{item.type}</span>
                      </div>
                    </li>
                  ))}
                </ul>
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
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Household ID</th>
                    <th>Representative</th>
                    <th>Purok</th>
                    <th>Registration Year</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {households.map((h) => (
                    <tr key={h.id}>
                      <td>{h.id}</td>
                      <td>{h.representative}</td>
                      <td>{h.purok}</td>
                      <td>{h.registrationYear}</td>
                      <td><span className={`status-badge status-${h.status}`}>{h.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          </section>
        )}

        {activeItem === "Attendance" && (
          <section className="panel">
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
                  {attendanceRecords.map((a) => (
                    <tr key={a.resident}>
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
    </div>
  );
}

export default Dashboard;