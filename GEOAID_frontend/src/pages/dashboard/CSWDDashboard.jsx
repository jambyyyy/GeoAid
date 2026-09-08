import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "./CSWDDashboard.css";
import Sidebar from "../../components/sidebar";
import { API_URL, readApiResponse } from "../../config";

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
  PWD: "flag-pwd",
  "4Ps": "flag-4ps",
  Pregnant: "flag-pregnant",
  Elderly: "flag-elderly",
  "Child<5": "flag-child5",
};

const sectionInfo = {
  Dashboard: { title: "CSWD Dashboard", subtitle: "City Social Welfare & Development — Relief & Beneficiary Operations" },
  "Relief Distribution": { title: "Relief Distribution", subtitle: "Track relief goods received, stocked, and distributed to verified households" },
  "Priority Beneficiaries": { title: "Priority Beneficiaries", subtitle: "Senior citizens, PWD, pregnant women, and children under 5" },
  Households: { title: "Households", subtitle: "Registered households under CSWD monitoring" },
  "Vulnerability Profiles": { title: "Vulnerability Profiles", subtitle: "Household vulnerability assessments and risk classification" },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy across active evacuation sites" },
  Donations: { title: "Relief Inventory", subtitle: "Current stock of relief goods available for distribution" },
  Reports: { title: "Relief Activity", subtitle: "Recent database-backed relief distribution records" },
  Settings: { title: "Settings", subtitle: "Manage your CSWD account preferences" },
};

function CSWDDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "CSWD Personnel";

  const [activeItem, setActiveItem] = useState("Dashboard");
  const [dashboardData, setDashboardData] = useState(null);
  const [reliefData, setReliefData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reliefLoading, setReliefLoading] = useState(false);
  const [error, setError] = useState("");
  const [reliefError, setReliefError] = useState("");
  const [success, setSuccess] = useState("");
  const [reportData, setReportData] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState("");
  const [reportFilters, setReportFilters] = useState({ start_date: "", end_date: "", barangay: "", disaster_id: "" });

  const [newItem, setNewItem] = useState({ name: "", unit: "pack", initial_stock: "" });
  const [receipt, setReceipt] = useState({ item_id: "", quantity: "", reference: "", notes: "" });
  const [distribution, setDistribution] = useState({
    household_code: "",
    disaster_id: "",
    notes: "",
    items: [{ item_id: "", quantity: "" }],
  });

  const loadRelief = async () => {
    setReliefLoading(true);
    setReliefError("");
    try {
      const response = await fetch(`${API_URL}/api/cswd/relief/`);
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Failed to load relief data.");
      setReliefData(data);
    } catch (err) {
      setReliefError(err.message);
    } finally {
      setReliefLoading(false);
    }
  };

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const response = await fetch(`${API_URL}/api/cswd/dashboard/`);
        const data = await readApiResponse(response);
        if (!response.ok) throw new Error(data.message || "Failed to load dashboard data.");
        setDashboardData(data);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchDashboard();
    loadRelief();
    loadReport();
  }, []);

  const loadReport = async (filters = reportFilters) => {
    setReportLoading(true);
    setReportError("");
    try {
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, value); });
      const response = await fetch(`${API_URL}/api/cswd/reports/?${params.toString()}`);
      const data = await readApiResponse(response);
      if (!response.ok) throw new Error(data.message || "Failed to load CSWD report.");
      setReportData(data);
    } catch (err) {
      setReportError(err.message);
    } finally {
      setReportLoading(false);
    }
  };

  const exportReport = () => {
    const params = new URLSearchParams({ format: "csv" });
    Object.entries(reportFilters).forEach(([key, value]) => { if (value) params.set(key, value); });
    window.open(`${API_URL}/api/cswd/reports/?${params.toString()}`, "_blank", "noopener,noreferrer");
  };

  const postRelief = async (payload) => {
    const response = await fetch(`${API_URL}/api/cswd/relief/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, ...payload }),
    });
    const data = await readApiResponse(response);
    if (!response.ok) throw new Error(data.message || "Relief operation failed.");
    return data;
  };

  const handleCreateItem = async (event) => {
    event.preventDefault();
    setSuccess("");
    setReliefError("");
    try {
      await postRelief({ action: "create_item", ...newItem, initial_stock: Number(newItem.initial_stock || 0) });
      setNewItem({ name: "", unit: "pack", initial_stock: "" });
      setSuccess("Relief item added.");
      await loadRelief();
    } catch (err) {
      setReliefError(err.message);
    }
  };

  const handleReceiveStock = async (event) => {
    event.preventDefault();
    setSuccess("");
    setReliefError("");
    try {
      await postRelief({ action: "receive_stock", ...receipt, quantity: Number(receipt.quantity) });
      setReceipt({ item_id: receipt.item_id, quantity: "", reference: "", notes: "" });
      setSuccess("Stock receipt recorded.");
      await loadRelief();
    } catch (err) {
      setReliefError(err.message);
    }
  };

  const handleDistribution = async (event) => {
    event.preventDefault();
    setSuccess("");
    setReliefError("");
    try {
      const items = distribution.items
        .filter((line) => line.item_id && Number(line.quantity) > 0)
        .map((line) => ({ item_id: Number(line.item_id), quantity: Number(line.quantity) }));

      if (!distribution.household_code || !items.length) {
        throw new Error("Select a confirmed household and at least one relief item.");
      }

      await postRelief({
        action: "record_distribution",
        household_code: distribution.household_code,
        disaster_id: distribution.disaster_id || null,
        notes: distribution.notes,
        items,
      });

      setDistribution({ household_code: "", disaster_id: "", notes: "", items: [{ item_id: "", quantity: "" }] });
      setSuccess("Relief distribution recorded and stock deducted.");
      await loadRelief();
      const dashboardResponse = await fetch(`${API_URL}/api/cswd/dashboard/`);
      if (dashboardResponse.ok) setDashboardData(await dashboardResponse.json());
    } catch (err) {
      setReliefError(err.message);
    }
  };

  const addDistributionLine = () =>
    setDistribution((current) => ({ ...current, items: [...current.items, { item_id: "", quantity: "" }] }));

  const updateDistributionLine = (index, field, value) =>
    setDistribution((current) => ({
      ...current,
      items: current.items.map((line, lineIndex) => (lineIndex === index ? { ...line, [field]: value } : line)),
    }));

  const removeDistributionLine = (index) =>
    setDistribution((current) => ({
      ...current,
      items: current.items.length === 1 ? current.items : current.items.filter((_, i) => i !== index),
    }));

  const { title, subtitle } = sectionInfo[activeItem];

  const inventory = reliefData?.inventory || dashboardData?.relief_inventory || [];
  const distributions = reliefData?.distributions || dashboardData?.recent_relief_distributions || [];
  const households = reliefData?.confirmed_households || dashboardData?.households || [];
  const disasters = reliefData?.disasters || dashboardData?.active_disasters || [];
  const checklist = dashboardData?.beneficiary_checklist || reliefData?.confirmed_households?.map((h) => ({
    household_code: h.id,
    household_name: h.family_name ? `${h.family_name} Family` : h.full_name,
    barangay: h.barangay,
    claimed: false,
  })) || [];

  const stockUnits = useMemo(
    () => inventory.reduce((sum, item) => sum + Number(item.stock_on_hand || 0), 0),
    [inventory]
  );

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    navigate("/");
  };

  if (loading) return <div className="dashboard-page"><div className="loading-container"><h2>Loading Dashboard...</h2></div></div>;
  if (error) return <div className="dashboard-page"><div className="error-container"><h2>{error}</h2></div></div>;

  const priority = dashboardData?.priority_beneficiaries || {};
  const reliefDistribution = dashboardData?.relief_distribution || [];
  const evacuationCenters = dashboardData?.evacuation_centers || [];

  return (
    <div className="dashboard-page">
      <Sidebar role="CSWD Panel" navItems={navItems} activeItem={activeItem} onNavItemClick={setActiveItem} />
      <div className="dashboard-main">
        <header className="dashboard-header">
          <div><h1>{title}</h1><p>{subtitle}</p></div>
          <div className="header-actions">
            <span className="user-badge">Signed in as {username}</span>
            <button type="button" className="logout-btn" onClick={handleLogout}>Logout</button>
          </div>
        </header>

        {success && <div className="success-banner">{success}</div>}
        {reliefError && <div className="error-banner">{reliefError}</div>}

        {activeItem === "Dashboard" && (
          <>
            <section className="stats-grid">
              <article className="stat-card stat-info"><span className="stat-value">{dashboardData?.total_households ?? 0}</span><span className="stat-label">Confirmed Households</span></article>
              <article className="stat-card stat-danger"><span className="stat-value">{dashboardData?.priority_cases ?? 0}</span><span className="stat-label">Priority Cases</span></article>
              <article className="stat-card stat-success"><span className="stat-value">{dashboardData?.relief_released ?? 0}</span><span className="stat-label">Relief Claims</span></article>
              <article className="stat-card stat-warning"><span className="stat-value">{stockUnits}</span><span className="stat-label">Units in Stock</span></article>
            </section>
            <section className="content-grid">
              <article className="panel">
                <h2>Relief Distribution Overview</h2>
                <div className="table-scroll">
                  <table className="data-table"><thead><tr><th>Barangay</th><th>Eligible</th><th>Claimed</th><th>Pending</th><th>Status</th></tr></thead>
                    <tbody>{reliefDistribution.length ? reliefDistribution.map((item) => (
                      <tr key={item.barangay}><td>{item.barangay}</td><td>{item.families}</td><td>{item.claimed_families}</td><td>{item.pending_families}</td><td><span className={`status-badge status-${String(item.status).toLowerCase()}`}>{item.status}</span></td></tr>
                    )) : <tr><td colSpan="5">No confirmed households yet.</td></tr>}</tbody>
                  </table>
                </div>
              </article>
              <article className="panel"><h2>Quick Actions</h2><div className="action-grid">
                <button type="button" className="action-btn" onClick={() => setActiveItem("Relief Distribution")}>Record Relief Distribution</button>
                <button type="button" className="action-btn" onClick={() => setActiveItem("Relief Distribution")}>Manage Relief Stock</button>
                <button type="button" className="action-btn" onClick={() => setActiveItem("Priority Beneficiaries")}>Review Priority Cases</button>
                <button type="button" className="action-btn" onClick={() => setActiveItem("Households")}>View Households</button>
              </div></article>
            </section>
          </>
        )}

        {activeItem === "Relief Distribution" && (
          <>
            <section className="relief-form-grid">
              <article className="panel">
                <h2>Add Relief Item</h2>
                <form className="form-grid" onSubmit={handleCreateItem}>
                  <label>Item name<input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} required /></label>
                  <label>Unit<input value={newItem.unit} onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })} required /></label>
                  <label>Initial stock<input type="number" min="0" value={newItem.initial_stock} onChange={(e) => setNewItem({ ...newItem, initial_stock: e.target.value })} /></label>
                  <button className="primary-btn" type="submit">Add item</button>
                </form>
              </article>
              <article className="panel">
                <h2>Receive Stock</h2>
                <form className="form-grid" onSubmit={handleReceiveStock}>
                  <label>Relief item<select value={receipt.item_id} onChange={(e) => setReceipt({ ...receipt, item_id: e.target.value })} required><option value="">Select item</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.stock_on_hand} {item.unit})</option>)}</select></label>
                  <label>Quantity<input type="number" min="1" value={receipt.quantity} onChange={(e) => setReceipt({ ...receipt, quantity: e.target.value })} required /></label>
                  <label>Reference<input value={receipt.reference} onChange={(e) => setReceipt({ ...receipt, reference: e.target.value })} placeholder="Receipt / delivery reference" /></label>
                  <button className="primary-btn" type="submit">Record receipt</button>
                </form>
              </article>
            </section>

            <section className="relief-form-grid">
              <article className="panel">
                <h2>Record Household Distribution</h2>
                <form className="form-grid" onSubmit={handleDistribution}>
                  <label>Confirmed household<select value={distribution.household_code} onChange={(e) => setDistribution({ ...distribution, household_code: e.target.value })} required><option value="">Select household</option>{households.map((h) => <option key={h.id || h.household_code} value={h.id || h.household_code}>{h.id || h.household_code} — {h.full_name || `${h.family_name} Family`} ({h.barangay})</option>)}</select></label>
                  <label>Active disaster<select value={distribution.disaster_id} onChange={(e) => setDistribution({ ...distribution, disaster_id: e.target.value })}><option value="">No disaster tag</option>{disasters.map((d) => <option key={d.id} value={d.id}>{d.name || d.disaster_type_name}</option>)}</select></label>
                  {distribution.items.map((line, index) => (
                    <div className="distribution-line" key={index}>
                      <select value={line.item_id} onChange={(e) => updateDistributionLine(index, "item_id", e.target.value)} required><option value="">Select relief item</option>{inventory.map((item) => <option key={item.id} value={item.id}>{item.name} — {item.stock_on_hand} {item.unit} available</option>)}</select>
                      <input type="number" min="1" value={line.quantity} onChange={(e) => updateDistributionLine(index, "quantity", e.target.value)} placeholder="Qty" required />
                      <button type="button" className="remove-btn" onClick={() => removeDistributionLine(index)}>Remove</button>
                    </div>
                  ))}
                  <button type="button" className="secondary-btn" onClick={addDistributionLine}>+ Add another item</button>
                  <label>Notes<textarea value={distribution.notes} onChange={(e) => setDistribution({ ...distribution, notes: e.target.value })} rows="2" /></label>
                  <button className="primary-btn" type="submit">Record distribution</button>
                </form>
              </article>

              <article className="panel">
                <h2>Current Stock</h2>
                <div className="table-scroll"><table className="data-table"><thead><tr><th>Item</th><th>Unit</th><th>On Hand</th></tr></thead><tbody>
                  {inventory.length ? inventory.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td><strong>{item.stock_on_hand}</strong></td></tr>) : <tr><td colSpan="3">No relief items configured.</td></tr>}
                </tbody></table></div>
              </article>
            </section>

            <section className="panel">
              <h2>Beneficiary Checklist</h2>
              <div className="table-scroll"><table className="data-table"><thead><tr><th>Household</th><th>Barangay</th><th>Relief Status</th></tr></thead><tbody>
                {checklist.length ? checklist.map((entry) => <tr key={entry.household_code}><td>{entry.household_name} ({entry.household_code})</td><td>{entry.barangay}</td><td><span className={`status-badge status-${entry.claimed ? "claimed" : "pending"}`}>{entry.claimed ? "Claimed" : "Pending"}</span></td></tr>) : <tr><td colSpan="3">No confirmed households yet.</td></tr>}
              </tbody></table></div>
            </section>

            <section className="panel">
              <h2>Distribution History</h2>
              {reliefLoading ? <p className="panel-note">Refreshing relief records…</p> : (
                <div className="table-scroll"><table className="data-table"><thead><tr><th>Household</th><th>Barangay</th><th>Goods</th><th>Date</th><th>Recorded By</th></tr></thead><tbody>
                  {distributions.length ? distributions.map((d) => <tr key={d.id}><td>{d.household_name} ({d.household_code})</td><td>{d.barangay}</td><td>{d.items.map((item) => `${item.name} × ${item.quantity} ${item.unit}`).join(", ")}</td><td>{new Date(d.distributed_at).toLocaleString()}</td><td>{d.recorded_by || "—"}</td></tr>) : <tr><td colSpan="5">No relief distributions recorded yet.</td></tr>}
                </tbody></table></div>
              )}
            </section>
          </>
        )}

        {activeItem === "Priority Beneficiaries" && <section className="panel"><ul className="list">{[
          ["Senior Citizens", priority.senior_citizens], ["PWD", priority.pwd], ["Pregnant Women", priority.pregnant], ["Children Below 5", priority.children]
        ].map(([label, value]) => <li key={label}><span>{label}</span><span className="value">{value ?? 0}</span></li>)}</ul></section>}

        {activeItem === "Households" && <section className="panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Household</th><th>Barangay</th><th>Purok</th><th>Members</th><th>Flags</th><th>Submitted</th></tr></thead><tbody>
          {(dashboardData?.households || []).length ? dashboardData.households.map((h) => <tr key={h.id}><td>{h.family_name} Family ({h.id})</td><td>{h.barangay}</td><td>{h.purok}</td><td>{h.members.length}</td><td>{h.flags.length ? h.flags.map((f) => <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`}>{f}</span>) : "—"}</td><td>{h.submitted}</td></tr>) : <tr><td colSpan="6">No confirmed households yet.</td></tr>}
        </tbody></table></div></section>}

        {activeItem === "Vulnerability Profiles" && <section className="panel"><p className="panel-note">Vulnerability classifications are calculated from the registered household member profiles. Use Priority Beneficiaries for the current city-wide counts.</p></section>}

        {activeItem === "Evacuation Centers" && <section className="panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Center</th><th>Barangay</th><th>Occupancy</th><th>Status</th></tr></thead><tbody>
          {evacuationCenters.length ? evacuationCenters.map((center) => <tr key={center.id}><td>{center.name}</td><td>{center.barangay}</td><td>{center.occupancy} / {center.capacity}</td><td><span className={`status-badge status-${center.status}`}>{center.status}</span></td></tr>) : <tr><td colSpan="4">No evacuation center records.</td></tr>}
        </tbody></table></div></section>}

        {activeItem === "Donations" && <section className="panel"><div className="table-scroll"><table className="data-table"><thead><tr><th>Relief Item</th><th>Unit</th><th>Available Stock</th></tr></thead><tbody>
          {inventory.length ? inventory.map((item) => <tr key={item.id}><td>{item.name}</td><td>{item.unit}</td><td>{item.stock_on_hand}</td></tr>) : <tr><td colSpan="3">No relief inventory records.</td></tr>}
        </tbody></table></div></section>}

        {activeItem === "Reports" && (
          <section className="report-stack">
            <article className="panel">
              <div className="report-toolbar">
                <div><h2>CSWD Relief Report</h2><p className="panel-note">Filter actual recorded relief claims by date, barangay, and disaster event, then export the matching records.</p></div>
                <button type="button" className="export-btn" onClick={exportReport} disabled={reportLoading}>Export CSV</button>
              </div>
              <div className="report-filters">
                <label>From<input type="date" value={reportFilters.start_date} onChange={(e) => setReportFilters({ ...reportFilters, start_date: e.target.value })} /></label>
                <label>To<input type="date" value={reportFilters.end_date} onChange={(e) => setReportFilters({ ...reportFilters, end_date: e.target.value })} /></label>
                <label>Barangay<select value={reportFilters.barangay} onChange={(e) => setReportFilters({ ...reportFilters, barangay: e.target.value })}><option value="">All barangays</option>{(reportData?.barangay_options || []).map((b) => <option key={b} value={b}>{b}</option>)}</select></label>
                <label>Disaster<select value={reportFilters.disaster_id} onChange={(e) => setReportFilters({ ...reportFilters, disaster_id: e.target.value })}><option value="">All events</option>{(reportData?.disasters || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
                <button type="button" className="action-btn report-apply" onClick={() => loadReport(reportFilters)}>Apply filters</button>
              </div>
              {reportError && <div className="error-banner">{reportError}</div>}
            </article>

            <section className="stats-grid report-stats">
              <article className="stat-card stat-info"><span className="stat-value">{reportData?.summary?.claims ?? 0}</span><span className="stat-label">Relief Claims</span></article>
              <article className="stat-card stat-success"><span className="stat-value">{reportData?.summary?.unique_households ?? 0}</span><span className="stat-label">Households Served</span></article>
              <article className="stat-card stat-warning"><span className="stat-value">{reportData?.summary?.units_distributed ?? 0}</span><span className="stat-label">Units Distributed</span></article>
              <article className="stat-card"><span className="stat-value">{reportData?.available_inventory?.reduce((sum, item) => sum + Number(item.stock_on_hand || 0), 0) ?? 0}</span><span className="stat-label">Current Units in Stock</span></article>
            </section>

            <div className="content-grid">
              <article className="panel"><h2>Distribution by Barangay</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Barangay</th><th>Households</th><th>Claims</th><th>Units</th></tr></thead><tbody>{(reportData?.barangays || []).length ? reportData.barangays.map((row) => <tr key={row.barangay}><td>{row.barangay}</td><td>{row.households}</td><td>{row.claims}</td><td>{row.units}</td></tr>) : <tr><td colSpan="4">No claims match the selected filters.</td></tr>}</tbody></table></div></article>
              <article className="panel"><h2>Goods Distributed</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Relief Item</th><th>Unit</th><th>Quantity</th><th>Lines</th></tr></thead><tbody>{(reportData?.items || []).length ? reportData.items.map((row) => <tr key={row.name}><td>{row.name}</td><td>{row.unit}</td><td>{row.quantity}</td><td>{row.distributions}</td></tr>) : <tr><td colSpan="4">No goods distributed in this report.</td></tr>}</tbody></table></div></article>
            </div>

            <article className="panel"><h2>Distribution Detail</h2><div className="table-scroll"><table className="data-table"><thead><tr><th>Household</th><th>Barangay</th><th>Disaster</th><th>Goods</th><th>Date</th><th>Recorded By</th></tr></thead><tbody>{(reportData?.distributions || []).length ? reportData.distributions.map((d) => <tr key={d.id}><td>{d.household_name} ({d.household_code})</td><td>{d.barangay}</td><td>{d.disaster || "—"}</td><td>{d.items.map((item) => `${item.name} × ${item.quantity}`).join(", ")}</td><td>{new Date(d.distributed_at).toLocaleString()}</td><td>{d.recorded_by || "—"}</td></tr>) : <tr><td colSpan="6">No distribution records found.</td></tr>}</tbody></table></div></article>
          </section>
        )}

        {activeItem === "Settings" && <section className="panel"><p className="panel-note">Account settings for CSWD personnel will be available here soon.</p></section>}
      </div>
    </div>
  );
}

export default CSWDDashboard;
