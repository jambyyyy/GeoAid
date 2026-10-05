import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import "./CSWDDashboard.css";
import Sidebar from "../../components/sidebar";
import { Paginated } from "../../components/Pagination";
import { API_URL } from "../../config";

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
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

const sectionInfo = {
  "Dashboard": { title: "CSWD Dashboard", subtitle: "City Social Welfare & Development — Relief & Beneficiary Operations" },
  "Relief Distribution": { title: "Relief Distribution", subtitle: "Release relief goods to each barangay's evacuation center and see how many households are inside" },
  "Households": { title: "Households", subtitle: "Registered households under CSWD monitoring" },
  "Vulnerability Profiles": { title: "Vulnerability Profiles", subtitle: "Senior citizens, PWD, pregnant women, and children under 5 — ranked by priority level" },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy across active evacuation sites" },
  "Donations": { title: "Donations", subtitle: "Donated goods available for distribution" },
  "Reports": { title: "Reports", subtitle: "Relief, vulnerability, and situation reports" },
  "Settings": { title: "Settings", subtitle: "Manage your CSWD account preferences" },
};


// Relief release lifecycle: CSWD records a release (Processing). It becomes
// Received only when the barangay confirms the goods arrived, from the
// Barangay dashboard — CSWD just sees the status here.
const RELIEF_STATUS_OPTIONS = [
  { value: "processing", label: "Processing" },
  { value: "ready", label: "Ready for Pickup" },
  { value: "claimed", label: "Claimed" },
  { value: "cancelled", label: "Cancelled" },
];

function ReliefStatusBadge({ value, label }) {
  const key = String(value || "").toLowerCase();
  const text = label || RELIEF_STATUS_OPTIONS.find((o) => o.value === key)?.label || value;
  return <span className={`status-badge status-${key}`}>{text}</span>;
}

const PRIORITY_CLASS = {
  High: "priority-high",
  Medium: "priority-medium",
  Low: "priority-low",
};

function CSWDDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "CSWD Personnel";

  const [activeItem, setActiveItem] = usePersistedChoice("geoaid_cswd_page", "Dashboard", (v) => v in sectionInfo);
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
  const [donationFormSuccess, setDonationFormSuccess] = useState("");

  const [reliefForm, setReliefForm] = useState({
    barangay: "",
    evacuation_center_id: "",
    goods_type: "",
    quantity: "",
    disaster_type_id: "",
    remarks: "",
  });
  const [isSubmittingRelief, setIsSubmittingRelief] = useState(false);
  const [reliefFormError, setReliefFormError] = useState("");
  const [reliefFormSuccess, setReliefFormSuccess] = useState("");

  const [expandedBarangay, setExpandedBarangay] = useState(null);
  const [expandedCenter, setExpandedCenter] = useState(null);

  const [stockForm, setStockForm] = useState({ goods_type: "", quantity: "" });
  const [isSubmittingStock, setIsSubmittingStock] = useState(false);
  const [stockFormError, setStockFormError] = useState("");
  const [stockFormSuccess, setStockFormSuccess] = useState("");

  const [reportForm, setReportForm] = useState({
    title: "",
    content: "",
    disaster_type_id: "",
  });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFormError, setReportFormError] = useState("");

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

  useEffect(() => {
    fetchDashboard();
  }, []);

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    sessionStorage.removeItem("geoaid_cswd_page");
    navigate("/");
  };

  const handleDonationFieldChange = (field, value) => {
    setDonationFormSuccess("");
    setDonationForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddDonation = async (e) => {
    e.preventDefault();
    setDonationFormError("");
    setDonationFormSuccess("");

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

      // Refetch so donation records and storage stock reflect the new donation.
      await fetchDashboard();
      setDonationPage(1);
      setDonationFormSuccess(
        data.stored_in_inventory && data.stock
          ? `Donation logged. ${data.donation.quantity} added to ${data.stock.label} storage — now ${data.stock.quantity} in storage.`
          : "Donation logged (not added to storage because it is marked Distributed or has no quantity)."
      );
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
    setReliefFormSuccess("");
    setReliefForm((prev) => ({
      ...prev,
      [field]: value,
      // A different barangay means a different set of evacuation centers.
      ...(field === "barangay" ? { evacuation_center_id: "" } : {}),
    }));
  };

  const handleRecordRelief = async (e) => {
    e.preventDefault();
    setReliefFormError("");
    setReliefFormSuccess("");

    if (!reliefForm.barangay || !reliefForm.goods_type.trim() || !reliefForm.quantity) {
      setReliefFormError("Barangay, goods type, and quantity are required.");
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

      // Refetch so the new release (Processing), stock and barangay overview all update.
      await fetchDashboard();

      setReliefFormSuccess(
        `Logged ${data.relief.quantity} ${data.relief.goods_type} for Brgy. ${data.relief.barangay}` +
        `${data.relief.evacuation_center ? ` (${data.relief.evacuation_center})` : ""}` +
        ` — covers ${data.relief.households_served} household${data.relief.households_served === 1 ? "" : "s"}. Now Processing.`
      );
      setReliefForm({
        barangay: "",
        evacuation_center_id: "",
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

  const handleStockFieldChange = (field, value) => {
    setStockFormSuccess("");
    setStockForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddStock = async (e) => {
    e.preventDefault();
    setStockFormError("");
    setStockFormSuccess("");

    if (!stockForm.goods_type || !stockForm.quantity) {
      setStockFormError("Goods type and quantity are required.");
      return;
    }

    setIsSubmittingStock(true);
    try {
      const response = await fetch(`${API_URL}/api/cswd/relief/stock/add/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stockForm),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setStockFormError(data.message || "Could not update stock. Please try again.");
        return;
      }

      setDashboardData((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          relief_stock: (prev.relief_stock || []).map((s) =>
            s.goods_type === data.stock.goods_type ? { ...s, quantity: data.stock.quantity } : s
          ),
        };
      });

      await fetchDashboard();
      setStockFormSuccess(`${data.stock.label} in storage is now ${data.stock.quantity}.`);
      setStockForm({ goods_type: "", quantity: "" });
    } catch (err) {
      console.error(err);
      setStockFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingStock(false);
    }
  };

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
  const reliefStock = dashboardData?.relief_stock || [];
  const evacuationCenters = dashboardData?.evacuation_centers || [];
  const allHouseholds = dashboardData?.households || [];
  const barangayRelief = dashboardData?.barangay_relief || [];

  // Evacuation centers (with their household counts) of the barangay
  // picked in the Record Relief form.
  const reliefFormCenters = evacuationCenters.filter((c) => c.barangay === reliefForm.barangay);
  const reliefFormBarangay = barangayRelief.find((b) => b.barangay === reliefForm.barangay);
  const reliefFormCenter = reliefForm.evacuation_center_id
    ? reliefFormCenters.find((c) => String(c.id) === String(reliefForm.evacuation_center_id))
    : reliefFormCenters.length === 1 ? reliefFormCenters[0] : null;

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

  const filteredBarangayRelief = (
    selectedBarangay === "All"
      ? barangayRelief
      : barangayRelief.filter((b) => b.barangay === selectedBarangay)
  );

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

              {reliefStock.map((s) => (
                <article key={s.goods_type} className="stat-card stat-info">
                  <span className="stat-value">{s.quantity}</span>
                  <span className="stat-label">{s.label} Left in Storage</span>
                </article>
              ))}
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Recent Relief Releases</h2>
                  <Paginated items={reliefDistribution}>{(pageRows) => (
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Barangay</th>
                        <th>Evacuation Center</th>
                        <th>Goods</th>
                        <th>Qty</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reliefDistribution.length > 0 ? (
                        pageRows.map((item) => (
                          <tr key={item.id}>
                            <td>{item.barangay}</td>
                            <td>{item.evacuation_center || "—"}</td>
                            <td>{item.goods_type}</td>
                            <td>{item.quantity}</td>
                            <td>
                              <ReliefStatusBadge value={item.claim_status} label={item.status} />
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan="5">No relief releases recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                  )}</Paginated>
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
          <section className="content-grid relief-tab">
            <article className="panel">
              <h2>Record Relief Distribution</h2>
              <form className="donation-form" onSubmit={handleRecordRelief}>
                {reliefFormError && <p className="donation-form-error">{reliefFormError}</p>}
                {reliefFormSuccess && <p className="panel-note">{reliefFormSuccess}</p>}

                <div className="donation-form-field">
                  <label htmlFor="relief_barangay">Barangay</label>
                  <select
                    id="relief_barangay"
                    value={reliefForm.barangay}
                    onChange={(e) => handleReliefFieldChange("barangay", e.target.value)}
                  >
                    <option value="">Select a barangay</option>
                    {BARANGAYS.map((b) => (
                      <option key={b} value={b}>{b}</option>
                    ))}
                  </select>
                </div>

                {reliefForm.barangay && (
                  <div className="donation-form-field">
                    <label htmlFor="relief_evacuation_center_id">Evacuation Center</label>
                    {reliefFormCenters.length > 0 ? (
                      <select
                        id="relief_evacuation_center_id"
                        value={reliefForm.evacuation_center_id || (reliefFormCenters.length === 1 ? String(reliefFormCenters[0].id) : "")}
                        onChange={(e) => handleReliefFieldChange("evacuation_center_id", e.target.value)}
                      >
                        {reliefFormCenters.length > 1 && <option value="">Select an evacuation center</option>}
                        {reliefFormCenters.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} — {c.households_in_center} household{c.households_in_center === 1 ? "" : "s"} inside
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="panel-note">
                        No evacuation center is set up for {reliefForm.barangay} yet — the release will
                        cover its {reliefFormBarangay?.registered_households ?? 0} confirmed household(s).
                      </p>
                    )}
                    {reliefFormCenter && (
                      <p className="panel-note">
                        {reliefFormCenter.households_in_center} household{reliefFormCenter.households_in_center === 1 ? "" : "s"} ·{" "}
                        {reliefFormCenter.members_in_center} {reliefFormCenter.members_in_center === 1 ? "person" : "people"} currently
                        checked in at {reliefFormCenter.name}.
                      </p>
                    )}
                  </div>
                )}

                <div className="donation-form-field">
                  <label htmlFor="relief_goods_type">Goods Type</label>
                  <div className="goods-selection-scroll">
                    {reliefStock.map((s) => (
                      <div
                        key={s.goods_type}
                        className={`goods-option ${reliefForm.goods_type === s.goods_type ? 'selected' : ''} ${s.quantity <= 0 ? 'out-of-stock' : ''}`}
                        onClick={() => s.quantity > 0 && handleReliefFieldChange("goods_type", s.goods_type)}
                      >
                        <span className="goods-name">{s.label}</span>
                        <span className="goods-quantity">{s.quantity} left</span>
                      </div>
                    ))}
                    {reliefStock.length === 0 && (
                      <p className="field-hint">No goods in storage yet.</p>
                    )}
                  </div>
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
              <h2>Relief Goods Storage</h2>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Goods Type</th>
                      <th>Left in Storage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reliefStock.map((s) => (
                      <tr key={s.goods_type}>
                        <td>{s.label}</td>
                        <td>{s.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>

            <article className="panel relief-wide">
              <h2>Relief Releases</h2>
              <p className="panel-note">
                A release stays Processing until the barangay staff confirm on their dashboard that
                they received it. The barangay then gives the goods to the households checked in at
                its evacuation center.
              </p>
                <Paginated items={reliefDistribution}>{(pageRows) => (
              <div className="table-scroll releases-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tracking No.</th>
                      <th>Barangay / Evacuation Center</th>
                      <th>Households</th>
                      <th>Goods</th>
                      <th>Qty</th>
                      <th>Date</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reliefDistribution.length > 0 ? (
                      pageRows.map((item) => {
                        return (
                          <tr key={item.id}>
                            <td>{item.tracking_number}</td>
                            <td>
                              {item.household_code
                                ? <>{item.household} ({item.household_code}){item.evacuation_center ? <div className="relief-received-at">Brgy. {item.barangay} · {item.evacuation_center}</div> : null}</>
                                : <>Brgy. {item.barangay}{item.evacuation_center ? <div className="relief-received-at">{item.evacuation_center}</div> : null}</>}
                            </td>
                            <td>{item.household_code ? 1 : item.households_served}</td>
                            <td>{item.goods_type}</td>
                            <td>{item.quantity}</td>
                            <td>{item.date}</td>
                            <td>
                              <ReliefStatusBadge value={item.claim_status} label={item.status} />
                              {item.claimed_at && (
                                <div className="relief-received-at">Received {item.claimed_at}</div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan="7">No relief releases recorded yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
            </article>

            <article className="panel relief-wide">
              <h2>Barangay Relief Overview</h2>
              <p className="panel-note">
                Relief goes to each barangay's evacuation center. Click a barangay to see the
                households currently inside its center.
              </p>
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
                  {filteredBarangayRelief.length} barangay{filteredBarangayRelief.length === 1 ? "" : "s"}
                </span>
              </div>

                <Paginated items={filteredBarangayRelief} resetKey={selectedBarangay}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Barangay</th>
                      <th>Evacuation Center</th>
                      <th>Households in Center</th>
                      <th>Registered Households</th>
                      <th>Status</th>
                      <th>Last Relief Given</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBarangayRelief.length > 0 ? (
                      pageRows.map((b) => (
                        <Fragment key={b.barangay}>
                          <tr
                            className="household-row"
                            onClick={() => setExpandedBarangay(expandedBarangay === b.barangay ? null : b.barangay)}
                          >
                            <td>
                              <span className="expand-caret">{expandedBarangay === b.barangay ? "▾" : "▸"}</span>{" "}
                              {b.barangay}
                            </td>
                            <td>
                              {b.evacuation_centers.length > 0
                                ? b.evacuation_centers.map((c) => c.name).join(", ")
                                : "—"}
                            </td>
                            <td>
                              {b.households_in_evacuation}
                              {b.members_in_evacuation > 0 && (
                                <span className="relief-received-at"> ({b.members_in_evacuation} people)</span>
                              )}
                            </td>
                            <td>{b.registered_households}</td>
                            <td>
                              <span className={`status-badge status-${String(b.relief_status).toLowerCase().replace(/\s+/g, "-")}`}>
                                {b.relief_status}
                              </span>
                            </td>
                            <td>
                              {b.last_goods
                                ? `${b.last_quantity}x ${b.last_goods} · ${b.last_date}`
                                : "—"}
                            </td>
                          </tr>

                          {expandedBarangay === b.barangay && (
                            <tr className="household-detail-row">
                              <td colSpan="6">
                                {b.evacuation_centers.length > 0 ? (
                                  b.evacuation_centers.map((c) => (
                                    <div key={c.id} className="household-detail-col" style={{ marginBottom: 12 }}>
                                      <p className="household-detail-label">
                                        {c.name} — {c.households_in_center} household{c.households_in_center === 1 ? "" : "s"} ·{" "}
                                        {c.members_in_center} {c.members_in_center === 1 ? "person" : "people"} · {c.occupancy} occupancy
                                      </p>
                                      {c.households.length > 0 ? (
                                        <Paginated items={c.households}>{(pageRows) => (
                                        <table className="data-table">
                                          <thead>
                                            <tr>
                                              <th>Household</th>
                                              <th>Purok</th>
                                              <th>Members Present</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {pageRows.map((h) => (
                                              <tr key={h.household_code}>
                                                <td>{h.family_name} Family ({h.household_code})</td>
                                                <td>{h.purok || "—"}</td>
                                                <td>{h.members_present}</td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                        )}</Paginated>
                                      ) : (
                                        <p className="household-detail-text">No households are checked in at this center right now.</p>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <p className="household-detail-text">No evacuation center is set up for {b.barangay} yet.</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6">No barangays found.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
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

                <Paginated items={filteredHouseholds} resetKey={selectedBarangay}>{(pageRows) => (
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
                      pageRows.map((h) => (
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
                )}</Paginated>
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

              <Paginated items={filteredHouseholds} resetKey={selectedBarangay}>{(pageRows) => (
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
                    pageRows.map((h) => (
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
              )}</Paginated>
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

              <Paginated items={filteredEvacuationCenters} resetKey={selectedBarangay}>{(pageRows) => (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Center</th>
                    <th>Barangay</th>
                    <th>Status</th>
                    <th>Occupancy</th>
                    <th>Households Inside</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEvacuationCenters.length > 0 ? (
                    pageRows.map((center) => (
                      <tr key={center.id}>
                        <td>{center.name}</td>
                        <td>{center.barangay}</td>
                        <td>
                          <span className={`status-badge status-${center.status}`}>
                            {center.status === "open" ? "OPEN" : "CLOSED"}
                          </span>
                        </td>
                        <td>{center.occupancy}</td>
                        <td>{center.households_in_center ?? 0}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan="5">
                        {selectedBarangay === "All"
                          ? "No evacuation centers have been added yet."
                          : `No evacuation center is set up yet for ${selectedBarangay}.`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              )}</Paginated>
          </section>
        )}

        {activeItem === "Donations" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Log a Donation</h2>
              <form className="donation-form" onSubmit={handleAddDonation}>
                {donationFormError && <p className="donation-form-error">{donationFormError}</p>}
                {donationFormSuccess && <p className="panel-note">{donationFormSuccess}</p>}

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
                  <select
                    id="goods_type"
                    value={donationForm.goods_type}
                    onChange={(e) => handleDonationFieldChange("goods_type", e.target.value)}
                  >
                    <option value="">Select goods type</option>
                    <option value="rice">Rice</option>
                    <option value="pack">Pack (all other goods)</option>
                  </select>
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
              <h2>Add to Storage</h2>
              <form className="donation-form" onSubmit={handleAddStock}>
                {stockFormError && <p className="donation-form-error">{stockFormError}</p>}
                {stockFormSuccess && <p className="panel-note">{stockFormSuccess}</p>}

                <div className="donation-form-field">
                  <label htmlFor="stock_goods_type">Goods Type</label>
                  <select
                    id="stock_goods_type"
                    value={stockForm.goods_type}
                    onChange={(e) => handleStockFieldChange("goods_type", e.target.value)}
                  >
                    <option value="">Select goods type</option>
                    <option value="rice">Rice</option>
                    <option value="pack">Pack (all other goods)</option>
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="stock_quantity">Quantity to Add</label>
                  <input
                    id="stock_quantity"
                    type="number"
                    min="1"
                    value={stockForm.quantity}
                    onChange={(e) => handleStockFieldChange("quantity", e.target.value)}
                  />
                </div>

                <div className="donation-form-actions">
                  <button type="submit" className="action-btn" disabled={isSubmittingStock}>
                    {isSubmittingStock ? "Saving…" : "Add to Storage"}
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
              Account settings for CSWD personnel will be available here soon.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}

export default CSWDDashboard;