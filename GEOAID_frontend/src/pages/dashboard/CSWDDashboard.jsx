import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import "./CSWDDashboard.css";
import Sidebar from "../../components/sidebar";
import { API_URL } from "../../config";

const navItems = [
  "Dashboard",
  "Relief Distribution",
  "Vulnerability Profiles",
  "Households",
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
  "Households": { title: "Households", subtitle: "Registered households under CSWD monitoring" },
  "Vulnerability Profiles": { title: "Vulnerability Profiles", subtitle: "Senior citizens, PWD, pregnant women, and children under 5 — ranked by priority level" },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy across active evacuation sites" },
  "Donations": { title: "Donations", subtitle: "Inventory of donated goods available for distribution" },
  "Reports": { title: "Reports", subtitle: "Relief, vulnerability, and situation reports" },
  "Settings": { title: "Settings", subtitle: "Manage your CSWD account preferences" },
};


const REPORT_TYPE_LABELS = {
  relief_vulnerability: "Relief & Vulnerability",
  situation: "Situation",
  disaster_monitoring: "Disaster Monitoring",
};

const PRIORITY_CLASS = {
  High: "priority-high",
  Medium: "priority-medium",
  Low: "priority-low",
};

function CSWDDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "CSWD Personnel";

  const [activeItem, setActiveItem] = useState("Dashboard");
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedBarangay, setSelectedBarangay] = useState("All");
  const [expandedHousehold, setExpandedHousehold] = useState(null);

  // Sourced from the database (Django admin > Barangays) via the
  // dashboard API's "barangays" field — not hardcoded, so adding or
  // removing a barangay there is reflected here automatically.
  const BARANGAYS = dashboardData?.barangays || [];

  const [donationRecords, setDonationRecords] = useState([]);
  const [donationPage, setDonationPage] = useState(1);
  const [expandedDonation, setExpandedDonation] = useState(null);
  const DONATIONS_PER_PAGE = 5;
  const [donationForm, setDonationForm] = useState({
    donor_name: "",
    contact_num: "",
    goods_type: "",
    quantity: "",
    donation_date: "",
    status: "pending",
    disaster_type_id: "",
  });
  const [isSubmittingDonation, setIsSubmittingDonation] = useState(false);
  const [donationFormError, setDonationFormError] = useState("");

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

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(
          `${API_URL}/api/cswd/dashboard/`
        );

        const data = await response.json();

        setDashboardData(data);
        setDonationRecords(data.donation_records || []);
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

  const handleDonationFieldChange = (field, value) => {
    setDonationForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddDonation = async (e) => {
    e.preventDefault();
    setDonationFormError("");

    if (!donationForm.donor_name.trim() || !donationForm.goods_type.trim() || !donationForm.quantity) {
      setDonationFormError("Donor name, goods type, and quantity are required.");
      return;
    }

    setIsSubmittingDonation(true);
    try {
      const response = await fetch(`${API_URL}/api/cswd/donations/add/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...donationForm, username }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setDonationFormError(data.message || "Could not log this donation. Please try again.");
        return;
      }

      setDonationRecords((prev) => [data.donation, ...prev]);
      setDonationPage(1);
      setDonationForm({
        donor_name: "",
        contact_num: "",
        goods_type: "",
        quantity: "",
        donation_date: "",
        status: "pending",
        disaster_type_id: "",
      });
    } catch (err) {
      console.error(err);
      setDonationFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingDonation(false);
    }
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
      const response = await fetch(`${API_URL}/api/cswd/relief/record/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reliefForm, username }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setReliefFormError(data.message || "Could not record this relief release. Please try again.");
        return;
      }

      // Update this household in place so the checklist table below
      // reflects "Relief Given" immediately, without waiting on a
      // full dashboard refetch.
      setDashboardData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          households: (prev.households || []).map((h) =>
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
          ),
        };
      });

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

      // Prepend the new report so it shows up immediately, without
      // waiting on a full dashboard refetch.
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

  const reliefDistribution = dashboardData?.relief_distribution || [];
  const evacuationCenters = dashboardData?.evacuation_centers || [];
  const allHouseholds = dashboardData?.households || [];

  // Filtered by the selected barangay, then sorted so the highest-priority
  // (most vulnerable) households surface first — this is what lets CSWD
  // staff scan one barangay and immediately see who needs attention.
  const filteredHouseholds = (
    selectedBarangay === "All"
      ? allHouseholds
      : allHouseholds.filter((h) => h.barangay === selectedBarangay)
  )
    .slice()
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0));

  const filteredEvacuationCenters = (
    selectedBarangay === "All"
      ? evacuationCenters
      : evacuationCenters.filter((c) => c.barangay === selectedBarangay)
  );

  const totalDonationPages = Math.max(1, Math.ceil(donationRecords.length / DONATIONS_PER_PAGE));
  const currentDonationPage = Math.min(donationPage, totalDonationPages);
  const paginatedDonations = donationRecords.slice(
    (currentDonationPage - 1) * DONATIONS_PER_PAGE,
    currentDonationPage * DONATIONS_PER_PAGE
  );

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
                <span className="stat-value">{dashboardData?.donations ?? 0}</span>
                <span className="stat-label">Donations Logged</span>
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
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Vulnerability Profiles")}>Review Priority Cases</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Households")}>View Households</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Evacuation Centers")}>Check Evacuation Centers</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Reports")}>Generate Report</button>
                </div>
              </article>
            </section>
          </>
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
                    {allHouseholds.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.family_name} Family ({h.id}) — {h.barangay}
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
              <div className="panel-toolbar">
                <label htmlFor="relief-barangay-filter" className="panel-toolbar-label">
                  Barangay:
                </label>
                <select
                  id="relief-barangay-filter"
                  className="barangay-select"
                  value={selectedBarangay}
                  onChange={(e) => setSelectedBarangay(e.target.value)}
                >
                  <option value="All">All Barangays</option>
                  {BARANGAYS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <span className="panel-toolbar-count">
                  {filteredHouseholds.length} household{filteredHouseholds.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Household</th>
                      <th>Barangay</th>
                      <th>Priority</th>
                      <th>Status</th>
                      <th>Last Relief Given</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHouseholds.length > 0 ? (
                      filteredHouseholds.map((h) => (
                        <tr key={h.id}>
                          <td>{h.family_name} Family ({h.id})</td>
                          <td>{h.barangay}</td>
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
                        <td colSpan="5">
                          {selectedBarangay === "All"
                            ? "No confirmed households yet."
                            : `No confirmed households in ${selectedBarangay} yet.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>
        )}

        {activeItem === "Vulnerability Profiles" && (
          <section className="panel">
            <h2>Vulnerability Profiles</h2>
              <div className="panel-toolbar">
                <label htmlFor="priority-barangay-filter" className="panel-toolbar-label">
                  Barangay:
                </label>
                <select
                  id="priority-barangay-filter"
                  className="barangay-select"
                  value={selectedBarangay}
                  onChange={(e) => setSelectedBarangay(e.target.value)}
                >
                  <option value="All">All Barangays</option>
                  {BARANGAYS.map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
                <span className="panel-toolbar-count">
                  {filteredHouseholds.length} household{filteredHouseholds.length === 1 ? "" : "s"} · highest priority first
                </span>
              </div>

              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Household</th>
                      <th>Barangay</th>
                      <th>Purok</th>
                      <th>Flags</th>
                      <th>Priority</th>
                      <th>Checked-In</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHouseholds.length > 0 ? (
                      filteredHouseholds.map((h) => (
                        <tr key={h.id}>
                          <td>{h.family_name} Family ({h.id})</td>
                          <td>{h.barangay}</td>
                          <td>{h.purok}</td>
                          <td>
                            {h.flags.length
                              ? h.flags.map((f) => (
                                <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`} style={{ marginRight: 4 }}>{f}</span>
                              ))
                              : "—"}
                          </td>
                          <td>
                            <span className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}>
                              {h.priority_level || "Low"}
                            </span>
                          </td>
                          <td>
                            {h.checked_in ? (
                              <span className="status-badge status-present">
                                {h.checked_in_members.length} @ {h.checked_in_center}
                              </span>
                            ) : (
                              <span className="status-badge status-checked-out">Not Checked In</span>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6">
                          {selectedBarangay === "All"
                            ? "No confirmed households yet."
                            : `No confirmed households in ${selectedBarangay} yet.`}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
        )}

        {activeItem === "Households" && (
          <section className="panel">
            <div className="panel-toolbar">
              <label htmlFor="barangay-filter" className="panel-toolbar-label">
                Barangay:
              </label>
              <select
                id="barangay-filter"
                className="barangay-select"
                value={selectedBarangay}
                onChange={(e) => setSelectedBarangay(e.target.value)}
              >
                <option value="All">All Barangays</option>
                {BARANGAYS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="panel-toolbar-count">
                {filteredHouseholds.length} household{filteredHouseholds.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Barangay</th>
                    <th>Purok</th>
                    <th>Members</th>
                    <th>Flags</th>
                    <th>Priority</th>
                    <th>Checked-In</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHouseholds.length > 0 ? (
                    filteredHouseholds.map((h) => (
                      <Fragment key={h.id}>
                        <tr
                          className="household-row"
                          onClick={() => setExpandedHousehold(expandedHousehold === h.id ? null : h.id)}
                        >
                          <td>
                            <span className="expand-caret">{expandedHousehold === h.id ? "▾" : "▸"}</span>
                            {h.family_name} Family ({h.id})
                          </td>
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
                          <td>
                            <span className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}>
                              {h.priority_level || "Low"}
                            </span>
                          </td>
                          <td>
                            {h.checked_in ? (
                              <span className="status-badge status-present">
                                {h.checked_in_members.length} @ {h.checked_in_center}
                              </span>
                            ) : (
                              <span className="status-badge status-checked-out">Not Checked In</span>
                            )}
                          </td>
                          <td>{h.submitted}</td>
                        </tr>

                        {expandedHousehold === h.id && (
                          <tr className="household-detail-row">
                            <td colSpan="8">
                              <div className="household-detail">
                                <div className="household-detail-col">
                                  <p className="household-detail-label">Household Members</p>
                                  <div className="member-list">
                                    {h.members.map((m, i) => {
                                      const isCheckedIn = h.checked_in_members?.includes(m.name);
                                      return (
                                        <div className="member-row" key={`${m.name}-${i}`}>
                                          <span className="member-name">{m.name}</span>
                                          <span className="member-meta">
                                            {m.relation} · Age {m.age}
                                            {m.tag ? ` · ${m.tag}` : ""}
                                          </span>
                                          {isCheckedIn && (
                                            <span className="status-badge status-present member-checkin-tag">
                                              Checked In
                                            </span>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>

                                <div className="household-detail-col">
                                  <p className="household-detail-label">Address</p>
                                  <p className="household-detail-text">{h.address}</p>
                                  {h.checked_in && (
                                    <>
                                      <p className="household-detail-label" style={{ marginTop: 14 }}>
                                        Currently Checked In
                                      </p>
                                      <p className="household-detail-text">
                                        {h.checked_in_members.join(", ")} — at {h.checked_in_center}
                                      </p>
                                    </>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="8">
                        {selectedBarangay === "All"
                          ? "No confirmed households yet."
                          : `No confirmed households in ${selectedBarangay} yet.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeItem === "Evacuation Centers" && (
          <section className="panel">
            <div className="panel-toolbar">
              <label htmlFor="evac-barangay-filter" className="panel-toolbar-label">
                Barangay:
              </label>
              <select
                id="evac-barangay-filter"
                className="barangay-select"
                value={selectedBarangay}
                onChange={(e) => setSelectedBarangay(e.target.value)}
              >
                <option value="All">All Barangays</option>
                {BARANGAYS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
              <span className="panel-toolbar-count">
                {filteredEvacuationCenters.length} center{filteredEvacuationCenters.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Center</th>
                    <th>Barangay</th>
                    <th>Status</th>
                    <th>Occupancy</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvacuationCenters.length > 0 ? (
                    filteredEvacuationCenters.map((center) => (
                      <tr key={center.id}>
                        <td>{center.name}</td>
                        <td>{center.barangay}</td>
                        <td>
                          <span className={`status-badge status-${center.status}`}>
                            {center.status === "open" ? "OPEN" : "CLOSED"}
                          </span>
                        </td>
                        <td>{center.occupancy}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="4">
                        {selectedBarangay === "All"
                          ? "No evacuation centers have been added yet."
                          : `No evacuation center is set up yet for ${selectedBarangay}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeItem === "Donations" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Log a Donation</h2>
              <form className="donation-form" onSubmit={handleAddDonation}>
                {donationFormError && <p className="donation-form-error">{donationFormError}</p>}

                <div className="donation-form-field">
                  <label htmlFor="donor_name">Donor Name</label>
                  <input
                    id="donor_name"
                    type="text"
                    value={donationForm.donor_name}
                    onChange={(e) => handleDonationFieldChange("donor_name", e.target.value)}
                    placeholder="e.g. Juan Dela Cruz"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="contact_num">Contact Number</label>
                  <input
                    id="contact_num"
                    type="text"
                    value={donationForm.contact_num}
                    onChange={(e) => handleDonationFieldChange("contact_num", e.target.value)}
                    placeholder="Optional"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="goods_type">Goods Type</label>
                  <input
                    id="goods_type"
                    type="text"
                    value={donationForm.goods_type}
                    onChange={(e) => handleDonationFieldChange("goods_type", e.target.value)}
                    placeholder="e.g. Rice Packs"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="quantity">Quantity</label>
                  <input
                    id="quantity"
                    type="number"
                    min="0"
                    value={donationForm.quantity}
                    onChange={(e) => handleDonationFieldChange("quantity", e.target.value)}
                    placeholder="e.g. 50"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="donation_date">Donation Date</label>
                  <input
                    id="donation_date"
                    type="date"
                    value={donationForm.donation_date}
                    onChange={(e) => handleDonationFieldChange("donation_date", e.target.value)}
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="status">Status</label>
                  <select
                    id="status"
                    value={donationForm.status}
                    onChange={(e) => handleDonationFieldChange("status", e.target.value)}
                  >
                    <option value="pending">Pending</option>
                    <option value="received">Received</option>
                    <option value="distributed">Distributed</option>
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="disaster_type_id">Disaster Type</label>
                  <select
                    id="disaster_type_id"
                    value={donationForm.disaster_type_id}
                    onChange={(e) => handleDonationFieldChange("disaster_type_id", e.target.value)}
                  >
                    <option value="">Not tied to a specific disaster</option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={dt.id}>
                        {dt.name}{dt.status === "closed" ? " (Closed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-actions">
                  <button type="submit" className="action-btn" disabled={isSubmittingDonation}>
                    {isSubmittingDonation ? "Saving…" : "Add Donation"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel">
              <h2>Donation Records</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Donor</th>
                      <th>Goods Type</th>
                      <th>Quantity</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDonations.length > 0 ? (
                      paginatedDonations.map((d) => (
                        <Fragment key={d.id}>
                          <tr
                            className="household-row"
                            onClick={() => setExpandedDonation(expandedDonation === d.id ? null : d.id)}
                          >
                            <td>
                              <span className="expand-caret">{expandedDonation === d.id ? "▾" : "▸"}</span>
                              {d.donor_name}
                            </td>
                            <td>{d.goods_type}</td>
                            <td>{d.quantity}</td>
                            <td>{d.donation_date}</td>
                            <td>
                              <span className={`status-badge status-${d.status}`}>{d.status}</span>
                            </td>
                          </tr>

                          {expandedDonation === d.id && (
                            <tr className="household-detail-row">
                              <td colSpan="5">
                                <dl className="details-list">
                                  <div className="details-row">
                                    <dt>Contact Number</dt>
                                    <dd>{d.contact_num || "—"}</dd>
                                  </div>
                                  <div className="details-row">
                                    <dt>Disaster Type</dt>
                                    <dd>{d.disaster_type || "—"}</dd>
                                  </div>
                                  <div className="details-row">
                                    <dt>Logged By</dt>
                                    <dd>{d.logged_by || "—"}</dd>
                                  </div>
                                </dl>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="5">No donations logged yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {donationRecords.length > DONATIONS_PER_PAGE && (
                <div className="panel-toolbar" style={{ marginTop: 14, marginBottom: 0 }}>
                  <button
                    type="button"
                    className="pagination-btn"
                    disabled={currentDonationPage === 1}
                    onClick={() => setDonationPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="panel-toolbar-count" style={{ marginLeft: 0 }}>
                    Page {currentDonationPage} of {totalDonationPages}
                  </span>
                  <button
                    type="button"
                    className="pagination-btn"
                    disabled={currentDonationPage === totalDonationPages}
                    onClick={() => setDonationPage((p) => Math.min(totalDonationPages, p + 1))}
                    style={{ marginLeft: "auto" }}
                  >
                    Next
                  </button>
                </div>
              )}
            </article>
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
                    placeholder="e.g. Weekly Relief & Vulnerability Report"
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