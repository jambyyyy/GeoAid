import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import "./dashboard.css";
import Sidebar from "../../components/sidebar";
import { Paginated } from "../../components/Pagination";
import { API_URL } from "../../config";

const navItems = [
  "Dashboard",
  "Household Registration",
  "Vulnerability Profiles",
  "Evacuation Centers",
  "Relief Distribution",
  "Attendance",
  "Reports",
];

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

const sectionInfo = (barangay) => ({
  "Dashboard": { title: "Barangay Staff Dashboard", subtitle: `Evacuation & Relief Operations${barangay ? ` — Brgy. ${barangay}` : ""}` },
  "Household Registration": { title: "Household Registration", subtitle: `Give final confirmation to households already approved by your Purok Presidents${barangay ? ` in Brgy. ${barangay}` : ""}` },
  "Vulnerability Profiles": { title: "Vulnerability Profiles", subtitle: `Senior citizens, PWD, pregnant women, and children under 5 — ranked by priority${barangay ? ` in Brgy. ${barangay}` : ""}` },
  "Evacuation Centers": { title: "Evacuation Centers", subtitle: "Monitor occupancy and status across barangay evacuation sites" },
  "Relief Distribution": { title: "Relief Distribution", subtitle: `Receive relief for your barangay and give it to the households checked in at your evacuation center${barangay ? ` — Brgy. ${barangay}` : ""}` },
  "Attendance": { title: "Evacuation Center Attendance", subtitle: "Resident check-ins confirmed via QR code scan" },
  "Reports": { title: "Reports", subtitle: "Situation, disaster monitoring, and relief & vulnerability reports" },
});

// Statuses barangay staff can set on a relief release.
// These are the active assembled packs from CSWD Inventory.
// Canned sardines and corned beef are INGREDIENTS of Food Pack, not an
// additional type of pack. Historical canned-only records remain intact.
const ACTIVE_RELIEF_PACKS = ["rice pack", "food pack", "medicine pack", "water pack"];
const isWholePositive = (value) => /^\d+$/.test(String(value).trim()) &&
  Number.isSafeInteger(Number(value)) && Number(value) > 0;

// Household releases advance one step at a time; older cancelled rows
// cannot be edited. CSWD batches have a separate Confirm Received button.
function ReliefActionButtons({ release, busy, onChange }) {
  const st = release.claim_status === "pending" ? "processing" : release.claim_status;
  if (st === "claimed") return <span className="relief-done">Received</span>;
  if (st === "cancelled") return <span className="relief-done">Cancelled</span>;
  const next = st === "processing"
    ? { value: "ready", label: "Mark Ready for Pickup" }
    : { value: "claimed", label: "Confirm Received" };
  return <button type="button" className="action-btn" disabled={busy}
    style={{ padding: "6px 10px", fontSize: "0.8rem" }}
    onClick={() => onChange(release, next.value)}>
    {busy ? "Saving…" : next.label}
  </button>;
}

const FLAG_CLASS = {
  "PWD": "flag-pwd",
  "Pregnant": "flag-pregnant",
  "Elderly": "flag-elderly",
  "Child<5": "flag-child5",
};

const PRIORITY_CLASS = {
  High: "priority-high",
  Medium: "priority-medium",
  Low: "priority-low",
};

const STATUS_LABEL = {
  approved: "Pending your confirmation",
  confirmed: "Confirmed — visible to CSWD/DRRM",
  rejected: "Rejected",
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
            <span className={`priority-badge ${PRIORITY_CLASS[household.priority_level] || ""}`}>
              {household.priority_level || "Low"} Priority
            </span>
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
              <div className="details-row">
                <dt>Vulnerability priority</dt>
                <dd>
                  <span className={`priority-badge ${PRIORITY_CLASS[household.priority_level] || ""}`}>
                    {household.priority_level || "Low"}
                  </span>{" "}
                  (score {household.priority_score ?? 0})
                </dd>
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
  const [activeItem, setActiveItem] = usePersistedChoice("geoaid_barangay_page", "Dashboard", (v) => v in sectionInfo(""));

  const [dashboardData, setDashboardData] = useState(null);
  const [households, setHouseholds] = useState([]);
  const [expandedCenter, setExpandedCenter] = useState(null);
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
  const [updatingReliefId, setUpdatingReliefId] = useState(null);
  const [reliefStatusError, setReliefStatusError] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState("waiting");
  const [queuePriorityFilter, setQueuePriorityFilter] = useState("All");

  const [reportForm, setReportForm] = useState({
    title: "",
    content: "",
    disaster_type_id: "",
  });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFormError, setReportFormError] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Evacuation center + attendance (scanned residents) — separate fetch
  // since it comes from barangay_evacuation_dashboard, not
  // barangay_dashboard. Kept optional (evacuationError, not the main
  // `error` state) so a missing EvacuationCenter doesn't block the rest
  // of the dashboard from loading.
  const [evacuationData, setEvacuationData] = useState(null);
  const [evacuationError, setEvacuationError] = useState("");

  const [activeTab, setActiveTab] = usePersistedChoice("geoaid_barangay_tab", "approved", (v) => ["approved", "confirmed", "rejected"].includes(v));
  const [expandedId, setExpandedId] = useState(null);
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [attendancePage, setAttendancePage] = useState(1);
  const ATTENDANCE_PAGE_SIZE = 5;
  const [expandedAttendanceHousehold, setExpandedAttendanceHousehold] = useState(null);
  const [toast, setToast] = useState(null);
  const [pendingAction, setPendingAction] = useState(null); // { id, type, familyName }
  const [isReviewing, setIsReviewing] = useState(false);

  // Resolved server-side from this account's First Name (Django admin >
  // Users), same convention Purok President dashboards use.
  const barangay = dashboardData?.barangay || "";

  const fetchDashboard = async ({ silent = false } = {}) => {
    try {
      const response = await fetch(
        `${API_URL}/api/barangay/dashboard/?username=${encodeURIComponent(username)}`
      );

      const data = await response.json();
      if (!response.ok || data.message) throw new Error(data.message || "Could not load Barangay dashboard.");
      setDashboardData(data);
      setHouseholds(data.households || []);
      setError("");
      return true;
    } catch (err) {
      console.error(err);
      if (!silent) setError(err.message || "Failed to load dashboard data.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // Relief availability/status are shared live with CSWD Inventory.
  // Refresh while distributing so newly confirmed arrivals appear.
  useEffect(() => {
    if (activeItem !== "Relief Distribution") return;
    const timer = window.setInterval(() => { fetchDashboard({ silent: true }); }, 30000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItem, username]);

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

  const vulnerabilitySummary = dashboardData?.vulnerability_summary || {};
  const vulnerabilityProfiles = dashboardData?.vulnerability_profiles || [];
  const visibleProfiles =
    priorityFilter === "All"
      ? vulnerabilityProfiles
      : vulnerabilityProfiles.filter((v) => v.priority_level === priorityFilter);

  // From the Vulnerability Profiles table: jump to that household's card
  // on the Household Registration page, already expanded.
  const openHousehold = (householdCode) => {
    const hh = households.find((h) => h.id === householdCode);
    if (!hh) return;
    if (["approved", "confirmed", "rejected"].includes(hh.status)) setActiveTab(hh.status);
    setExpandedId(hh.id);
    setActiveItem("Household Registration");
  };

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    sessionStorage.removeItem("geoaid_barangay_page");
    sessionStorage.removeItem("geoaid_barangay_tab");
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

  const handleReliefFieldChange = (field, value) => {
    setReliefFormError("");
    setReliefFormSuccess("");
    setReliefForm((prev) => ({ ...prev, [field]: value,
      ...(field === "goods_type" ? { quantity: "" } : {}),
    }));
  };

  // Household issues draw ONLY from this barangay's confirmed CSWD
  // receipts. The server repeats every validation and stock check.
  const handleRecordRelief = async (e) => {
    e.preventDefault();
    if (isSubmittingRelief) return;
    setReliefFormError("");
    setReliefFormSuccess("");

    const pool = dashboardData?.relief_pool || {};
    const available = Number(pool[reliefForm.goods_type] || 0);
    const eligible = (dashboardData?.evacuation_centers || []).some((center) =>
      (center.households || []).some((h) => h.household_code === reliefForm.household_code));
    if (!reliefForm.household_code || !eligible) {
      setReliefFormError("Choose a household currently checked in at your barangay evacuation center.");
      return;
    }
    if (!ACTIVE_RELIEF_PACKS.includes(reliefForm.goods_type) || available <= 0) {
      setReliefFormError("Select an assembled pack that your barangay has received and still has available.");
      return;
    }
    if (!isWholePositive(reliefForm.quantity) || Number(reliefForm.quantity) > available) {
      setReliefFormError(`Enter a whole number from 1 to ${available} for this pack.`);
      return;
    }
    if (reliefForm.disaster_type_id !== "general" &&
        !(dashboardData?.disaster_types || []).some((d) => String(d.id) === String(reliefForm.disaster_type_id))) {
      setReliefFormError("Choose General Relief or an active disaster type.");
      return;
    }
    if (!reliefForm.remarks.trim() || reliefForm.remarks.trim().length > 255) {
      setReliefFormError("Enter remarks (1 to 255 characters) before recording the distribution.");
      return;
    }

    setIsSubmittingRelief(true);
    try {
      const response = await fetch(`${API_URL}/api/barangay/relief/record/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...reliefForm, username, remarks: reliefForm.remarks.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setReliefFormError(data.message || "Could not record this relief release. Please try again.");
        await fetchDashboard({ silent: true }); // stock may have changed since selection
        return;
      }
      const refreshed = await fetchDashboard({ silent: true });
      setReliefFormSuccess(
        `Recorded ${data.relief.quantity} ${data.relief.goods_type} for ${data.relief.family_name} Family — Processing.` +
        (refreshed ? "" : " Refresh the page to see the latest balance.")
      );
      setReliefForm({ household_code: "", goods_type: "", quantity: "", disaster_type_id: "", remarks: "" });
    } catch (err) {
      console.error(err);
      setReliefFormError("Unable to connect to the server. Check whether the transaction was saved before trying again.");
    } finally {
      setIsSubmittingRelief(false);
    }
  };

  // Barangay staff move a release Processing -> Ready for Pickup ->
  // Received. Received locks it (no further changes).
  const handleReliefStatusChange = async (release, newStatus) => {
    if (newStatus === release.claim_status) return;
    if (newStatus === "claimed" && !window.confirm(
      `Confirm that release ${release.tracking_number} was actually received? This cannot be undone.`
    )) return;

    setReliefStatusError("");
    setUpdatingReliefId(release.id);
    try {
      const response = await fetch(`${API_URL}/api/barangay/relief/status/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: release.id, status: newStatus, username }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setReliefStatusError(data.message || "Could not update this relief release.");
        return;
      }

      // Refetch so the release table, the barangay's available goods and
      // each household's relief status all stay in sync.
      await fetchDashboard({ silent: true });
      showToast(`Release ${release.tracking_number} marked ${data.relief.status}`);
    } catch (err) {
      console.error(err);
      setReliefStatusError("Unable to connect to the server.");
    } finally {
      setUpdatingReliefId(null);
    }
  };

  const toggleExpand = (id) => {
    setExpandedId((current) => (current === id ? null : id));
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
  const myCenters = dashboardData?.evacuation_centers || [];
  const reliefReleases = dashboardData?.relief_releases || [];
  const householdRelief = dashboardData?.household_relief || [];
  const reliefPool = dashboardData?.relief_pool || {};
  // Use the same four active pack types as CSWD. Zero/legacy categories
  // are not shown as selectable finished goods in Barangay.
  const availablePacks = ACTIVE_RELIEF_PACKS
    .map((goods) => ({ goods, qty: Number(reliefPool[goods] || 0) }))
    .filter(({ qty }) => qty > 0);
  const selectedGoodsAvailable = Number(reliefPool[reliefForm.goods_type] || 0);
  // The queue contains confirmed households with members currently checked
  // in. A household appears once, even if legacy attendance records place
  // its family members at more than one center.
  const confirmedCodes = new Set(confirmedHouseholds.map((h) => h.id));
  const checkedInByCode = new Map();
  for (const center of myCenters) {
    for (const h of center.households || []) {
      if (!confirmedCodes.has(h.household_code)) continue;
      const row = { ...h, center_name: center.name };
      const previous = checkedInByCode.get(h.household_code);
      if (!previous || (Number(h.members_present) || 0) > (Number(previous.members_present) || 0)) {
        checkedInByCode.set(h.household_code, row);
      }
    }
  }
  const checkedInHouseholds = Array.from(checkedInByCode.values()).sort(
    (a, b) =>
      (Number(b.priority_score) || 0) - (Number(a.priority_score) || 0) ||
      String(a.family_name).localeCompare(String(b.family_name)) ||
      String(a.household_code).localeCompare(String(b.household_code))
  );

  const reliefQueue = checkedInHouseholds.filter((h) => h.relief_status === "Not Yet Given");
  const inProgressQueue = checkedInHouseholds.filter((h) =>
    h.relief_status === "Processing" || h.relief_status === "Ready for Pickup"
  );
  const receivedQueue = checkedInHouseholds.filter((h) => h.relief_status === "Relief Given");
  const shownReliefQueue = checkedInHouseholds.filter((h) => {
    const statusMatch = queueStatusFilter === "all" ||
      (queueStatusFilter === "waiting" && h.relief_status === "Not Yet Given") ||
      (queueStatusFilter === "progress" && ["Processing", "Ready for Pickup"].includes(h.relief_status)) ||
      (queueStatusFilter === "received" && h.relief_status === "Relief Given");
    return statusMatch && (queuePriorityFilter === "All" || h.priority_level === queuePriorityFilter);
  });
  const nextInLine = reliefQueue[0];
  const selectedReliefHousehold = checkedInHouseholds.find(
    (h) => h.household_code === reliefForm.household_code
  );

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
                <span className="stat-value">{dashboardData?.households_in_evacuation ?? 0}</span>
                <span className="stat-label">Households in Evacuation Center</span>
              </article>
              <article className="stat-card stat-danger">
                <span className="stat-value">{vulnerabilitySummary.high ?? 0}</span>
                <span className="stat-label">High-Priority Households</span>
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
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Vulnerability Profiles")}>View Vulnerability Profiles</button>
                  <button type="button" className="action-btn" onClick={() => setActiveItem("Relief Distribution")}>Distribute Relief</button>
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
              <Paginated items={visibleHouseholds} resetKey={activeTab}>{(pageHouseholds) => (
              <>
              {pageHouseholds.map((h) => (
                <HouseholdCard
                  key={h.id}
                  household={h}
                  expanded={expandedId === h.id}
                  onToggle={toggleExpand}
                  onConfirm={requestConfirm}
                  onReject={requestReject}
                />
              ))}
              </>
              )}</Paginated>
            </div>
          </section>
        )}

        {activeItem === "Vulnerability Profiles" && (
          <>
            <section className="stats-grid">
              <article className="stat-card stat-danger">
                <span className="stat-value">{vulnerabilitySummary.high ?? 0}</span>
                <span className="stat-label">High Priority</span>
              </article>
              <article className="stat-card stat-warning">
                <span className="stat-value">{vulnerabilitySummary.medium ?? 0}</span>
                <span className="stat-label">Medium Priority</span>
              </article>
              <article className="stat-card stat-success">
                <span className="stat-value">{vulnerabilitySummary.low ?? 0}</span>
                <span className="stat-label">Low Priority</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{vulnerabilitySummary.senior_citizens ?? 0}</span>
                <span className="stat-label">Senior Citizens (60+)</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{vulnerabilitySummary.pwd ?? 0}</span>
                <span className="stat-label">PWD</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{vulnerabilitySummary.pregnant ?? 0}</span>
                <span className="stat-label">Pregnant</span>
              </article>
              <article className="stat-card stat-info">
                <span className="stat-value">{vulnerabilitySummary.children ?? 0}</span>
                <span className="stat-label">Children Under 5</span>
              </article>
            </section>

            <section className="panel">
              <h2>Household Vulnerability Ranking</h2>
              <p className="panel-note">
                Only households you have confirmed are profiled. Priority is scored from each member&apos;s
                flags: PWD and Pregnant count 2, Elderly and Child under 5 count 1 (High is 3 or more).
              </p>
              <div className="panel-toolbar">
                <label htmlFor="priority-level-filter" className="panel-toolbar-label">
                  Priority:
                </label>
                <select
                  id="priority-level-filter"
                  className="barangay-select"
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                >
                  <option value="All">All Levels</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
                <span className="panel-toolbar-count">
                  {visibleProfiles.length} household{visibleProfiles.length === 1 ? "" : "s"} · highest priority first
                </span>
              </div>

                <Paginated items={visibleProfiles} resetKey={priorityFilter}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Household</th>
                      <th>Purok</th>
                      <th>Members</th>
                      <th>Flags</th>
                      <th>Key Member</th>
                      <th>Score</th>
                      <th>Priority</th>
                      <th>Household</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProfiles.length > 0 ? (
                      pageRows.map((v) => (
                        <tr key={v.id}>
                          <td>{v.family_name} Family ({v.household_code})</td>
                          <td>{v.purok}</td>
                          <td>{v.members}</td>
                          <td>
                            {v.flags.length
                              ? v.flags.map((f) => (
                                <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`} style={{ marginRight: 4 }}>{f}</span>
                              ))
                              : "—"}
                          </td>
                          <td>{v.key_member || "—"}</td>
                          <td>{v.priority_score}</td>
                          <td>
                            <span className={`priority-badge ${PRIORITY_CLASS[v.priority_level] || ""}`}>
                              {v.priority_level}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="action-btn"
                              style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                              onClick={() => openHousehold(v.household_code)}
                            >
                              View
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8">
                          {vulnerabilityProfiles.length === 0
                            ? "No confirmed households yet. Profiles appear here once you confirm a household."
                            : "No households match this priority level."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
            </section>
          </>
        )}

        {activeItem === "Evacuation Centers" && (
          <section className="panel">
            {evacuationError ? (
              <p className="empty-state">{evacuationError}</p>
            ) : !evacuationData?.evacuation_centers?.length ? (
              <p className="empty-state">Loading evacuation center data…</p>
            ) : (
                <Paginated items={evacuationData.evacuation_centers}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Center Name</th>
                      <th>Barangay</th>
                      <th>Capacity</th>
                      <th>Occupancy</th>
                      <th>Households Inside</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((c) => (
                      <tr key={c.id}>
                        <td>{c.name}</td>
                        <td>{c.barangay}</td>
                        <td>{c.capacity}</td>
                        <td>{c.occupancy} / {c.capacity}</td>
                        <td>{c.households_in_center ?? 0}</td>
                        <td><span className={`status-badge status-${c.status}`}>{c.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
            )}
          </section>
        )}

        {activeItem === "Relief Distribution" && (
          <section className="content-grid barangay-relief-tab">
            <article className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2>Relief Goods Available to Your Barangay</h2>
              <p className="panel-note">
                What CSWD released to {barangay ? `Brgy. ${barangay}` : "your barangay"} and was marked
                Received, minus what you already gave to households.
              </p>
              <div className="stats-grid">
                {availablePacks.map(({ goods, qty }) => (
                  <article key={goods} className="stat-card stat-info">
                    <span className="stat-value">{qty}</span>
                    <span className="stat-label">{goods.charAt(0).toUpperCase() + goods.slice(1)} Available</span>
                  </article>
                ))}
                {availablePacks.length === 0 && (
                  <p className="panel-note">No received packs available yet. Confirm a CSWD release below after it arrives.</p>
                )}
              </div>
              {Number(dashboardData?.legacy_canned_balance || 0) > 0 && (
                <p className="panel-note">{dashboardData.legacy_canned_balance} older canned-only packs are recorded separately. They have not been counted as Food Packs because their contents may differ. Ask CSWD to reconcile this older stock before using it.</p>
              )}
            </article>

            <article className="panel" style={{ gridColumn: "1 / -1" }}>
              <h2>Give Relief to a Checked-In Household</h2>
              <form className="donation-form" onSubmit={handleRecordRelief}>
                {reliefFormError && <p className="donation-form-error">{reliefFormError}</p>}
                {reliefFormSuccess && <p className="panel-note">{reliefFormSuccess}</p>}

                <div className="donation-form-field">
                  <label htmlFor="relief_household_code">Household</label>
                  <select
                    id="relief_household_code"
                    required
                    value={reliefForm.household_code}
                    onChange={(e) => handleReliefFieldChange("household_code", e.target.value)}
                  >
                    <option value="">Select a household checked in at your evacuation center</option>
                    {checkedInHouseholds.map((h) => (
                      <option key={h.household_code} value={h.household_code}>
                        [{h.priority_level || "Low"}] {h.family_name} Family ({h.household_code}) — {h.center_name} · {h.relief_status}
                      </option>
                    ))}
                  </select>
                  {selectedReliefHousehold &&
                    selectedReliefHousehold.relief_status === "Not Yet Given" &&
                    nextInLine &&
                    nextInLine.household_code !== selectedReliefHousehold.household_code &&
                    (nextInLine.priority_score ?? 0) > (selectedReliefHousehold.priority_score ?? 0) && (
                      <p className="panel-note" style={{ marginTop: 6 }}>
                        Heads up: {nextInLine.family_name} Family ({nextInLine.priority_level} priority) is
                        still waiting and is ahead of this household in the queue.
                      </p>
                    )}
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_goods_type">Goods Type</label>
                  <select
                    id="relief_goods_type"
                    required
                    value={reliefForm.goods_type}
                    onChange={(e) => handleReliefFieldChange("goods_type", e.target.value)}
                  >
                    <option value="">Select goods</option>
                    {availablePacks.map(({ goods, qty }) => (
                      <option key={goods} value={goods}>
                        {goods.charAt(0).toUpperCase() + goods.slice(1)} — {qty} available
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">Goods come from CSWD's finished packs, after your barangay confirms receipt. Canned goods are included as Food Pack ingredients.</span>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_quantity">Quantity</label>
                  <input
                    id="relief_quantity"
                    type="number"
                    min="1"
                    step="1"
                    max={selectedGoodsAvailable || undefined}
                    required
                    value={reliefForm.quantity}
                    onChange={(e) => handleReliefFieldChange("quantity", e.target.value)}
                  />
                  {reliefForm.goods_type && (
                    <span className="field-hint">Received and available: {selectedGoodsAvailable} packs. After distribution: {Math.max(0, selectedGoodsAvailable - (Number(reliefForm.quantity) || 0))} packs.</span>
                  )}
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_disaster_type_id">Disaster Type</label>
                  <select
                    id="relief_disaster_type_id"
                    required
                    value={reliefForm.disaster_type_id}
                    onChange={(e) => handleReliefFieldChange("disaster_type_id", e.target.value)}
                  >
                    <option value="">Select release purpose</option>
                    <option value="general">General Relief (no specific disaster)</option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={dt.id}>{dt.name}</option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_remarks">Remarks</label>
                  <input
                    id="relief_remarks"
                    type="text"
                    required
                    maxLength={255}
                    value={reliefForm.remarks}
                    onChange={(e) => handleReliefFieldChange("remarks", e.target.value)}
                    placeholder="e.g. Picked up by household head"
                  />
                </div>

                <div className="donation-form-actions">
                  <button type="submit" className="action-btn" disabled={isSubmittingRelief || availablePacks.length === 0}>
                    {isSubmittingRelief ? "Saving…" : "Record Relief Release"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel relief-wide" style={{ gridColumn: "1 / -1" }}>
              <h2>Relief Priority Queue</h2>
              <p className="panel-note">
                {reliefQueue.length} waiting · {inProgressQueue.length} processing or ready · {receivedQueue.length} received.
                Priority is based on confirmed household vulnerability profiles.
              </p>
              <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap", margin: "14px 0 16px" }}>
                <div className="donation-form-field" style={{ flex: "1 1 180px" }}>
                  <label htmlFor="queue_status_filter">Status</label>
                  <select id="queue_status_filter" value={queueStatusFilter}
                    onChange={(e) => setQueueStatusFilter(e.target.value)}>
                    <option value="waiting">Waiting for Relief</option>
                    <option value="progress">Processing / Ready</option>
                    <option value="received">Received</option>
                    <option value="all">All Checked-In Households</option>
                  </select>
                </div>
                <div className="donation-form-field" style={{ flex: "1 1 180px" }}>
                  <label htmlFor="queue_priority_filter">Priority</label>
                  <select id="queue_priority_filter" value={queuePriorityFilter}
                    onChange={(e) => setQueuePriorityFilter(e.target.value)}>
                    <option value="All">All Priorities</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                    <option value="Low">Low</option>
                  </select>
                </div>
                <span className="household-meta">{shownReliefQueue.length} household{shownReliefQueue.length === 1 ? "" : "s"}</span>
              </div>
              {reliefStatusError && <p className="donation-form-error">{reliefStatusError}</p>}
              <Paginated items={shownReliefQueue} resetKey={`${queueStatusFilter}|${queuePriorityFilter}`}>
                {(pageRows, rowOffset) => (
                  <div className="table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Household / Purok</th>
                          <th>Evacuation Center</th>
                          <th>Priority</th>
                          <th>Vulnerabilities</th>
                          <th>Present</th>
                          <th>Relief Status / Last Release</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {shownReliefQueue.length > 0 ? pageRows.map((h, i) => (
                          <tr key={h.household_code}>
                            <td>{rowOffset + i + 1}</td>
                            <td>
                              <strong>{h.family_name} Family</strong>
                              <div className="household-submitted">{h.household_code} · {h.purok || "Purok not set"}</div>
                            </td>
                            <td>{h.center_name}</td>
                            <td>
                              <span className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}>
                                {h.priority_level || "Low"}
                              </span>
                            </td>
                            <td>
                              {(h.flags || []).length ? h.flags.map((f) => (
                                <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`} style={{ marginRight: 4 }}>{f}</span>
                              )) : "None recorded"}
                            </td>
                            <td>{h.members_present}</td>
                            <td>
                              <span className={`status-badge status-${h.relief_status === "Relief Given" ? "claimed" : "pending"}`}>
                                {h.relief_status === "Relief Given" ? "Received" : h.relief_status}
                              </span>
                              {h.relief_last && <div className="household-submitted">{h.relief_last}</div>}
                            </td>
                            <td>
                              {h.relief_status === "Not Yet Given" ? (
                                <button type="button" className="action-btn"
                                  disabled={availablePacks.length === 0}
                                  title={availablePacks.length === 0 ? "Confirm receipt of available CSWD packs first" : `Allocate relief to ${h.family_name} Family`}
                                  style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                                  onClick={() => {
                                    handleReliefFieldChange("household_code", h.household_code);
                                    document.getElementById("relief_household_code")?.scrollIntoView({ behavior: "smooth", block: "center" });
                                  }}>
                                  Give Relief
                                </button>
                              ) : h.active_relief ? (
                                <ReliefActionButtons release={h.active_relief}
                                  busy={updatingReliefId === h.active_relief.id}
                                  onChange={handleReliefStatusChange} />
                              ) : (
                                <span className="household-submitted">Received</span>
                              )}
                            </td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan="8">
                              {checkedInHouseholds.length === 0
                                ? "No confirmed households are checked in at this barangay's evacuation centers."
                                : queueStatusFilter === "waiting" && queuePriorityFilter === "All"
                                  ? "No households are currently waiting for their first relief allocation."
                                  : "No households match these filters."}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paginated>
            </article>

            <article className="panel relief-wide" style={{ gridColumn: "1 / -1" }}>
              <h2>Households in Your Evacuation Center</h2>
              <p className="panel-note">
                {dashboardData?.households_in_evacuation ?? 0} household
                {(dashboardData?.households_in_evacuation ?? 0) === 1 ? "" : "s"} currently checked in.
                Click a center to see them and give relief.
              </p>
                <Paginated items={myCenters}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Evacuation Center</th>
                      <th>Status</th>
                      <th>Occupancy</th>
                      <th>Households Inside</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myCenters.length > 0 ? (
                      pageRows.map((c) => (
                        <Fragment key={c.id}>
                          <tr
                            className="household-row"
                            onClick={() => setExpandedCenter(expandedCenter === c.id ? null : c.id)}
                          >
                            <td>
                              <span className="expand-caret">{expandedCenter === c.id ? "▾" : "▸"}</span> {c.name}
                            </td>
                            <td><span className={`status-badge status-${c.status}`}>{c.status}</span></td>
                            <td>{c.occupancy}</td>
                            <td>
                              {c.households_in_center}
                              {c.members_in_center > 0 && (
                                <span className="relief-received-at"> ({c.members_in_center} people)</span>
                              )}
                            </td>
                          </tr>
                          {expandedCenter === c.id && (
                            <tr className="household-detail-row">
                              <td colSpan="4">
                                {c.households.length > 0 ? (
                                  <Paginated items={c.households}>{(pageRows) => (
                                  <table className="data-table">
                                    <thead>
                                      <tr>
                                        <th>Household</th>
                                        <th>Priority</th>
                                        <th>Purok</th>
                                        <th>Members Present</th>
                                        <th>Relief</th>
                                        <th>Last Relief Given</th>
                                        <th></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {pageRows.map((h) => (
                                        <tr key={h.household_code}>
                                          <td>{h.family_name} Family ({h.household_code})</td>
                                          <td>
                                            <span className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}>
                                              {h.priority_level || "Low"}
                                            </span>
                                          </td>
                                          <td>{h.purok || "—"}</td>
                                          <td>{h.members_present}</td>
                                          <td>
                                            <span className={`status-badge status-${String(h.relief_status).toLowerCase().replace(/\s+/g, "-")}`}>
                                              {h.relief_status}
                                            </span>
                                          </td>
                                          <td>{h.relief_last || "—"}</td>
                                          <td>
                                            <button
                                              type="button"
                                              className="action-btn"
                                              style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                handleReliefFieldChange("household_code", h.household_code);
                                                window.scrollTo({ top: 0, behavior: "smooth" });
                                              }}
                                            >
                                              Give Relief
                                            </button>
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  )}</Paginated>
                                ) : (
                                  <p className="household-detail-text">No households are checked in at this center right now.</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="4">No evacuation center is set up for {barangay || "this barangay"} yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
            </article>

            <article className="panel relief-wide" style={{ gridColumn: "1 / -1" }}>
              <h2>Relief Given to Households</h2>
              {reliefStatusError && <p className="donation-form-error">{reliefStatusError}</p>}
                <Paginated items={householdRelief}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tracking No.</th>
                      <th>Household</th>
                      <th>Evacuation Center</th>
                      <th>Goods</th>
                      <th>Qty</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {householdRelief.length > 0 ? (
                      pageRows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.tracking_number}</td>
                          <td>{r.family_name} Family ({r.household_code})</td>
                          <td>{r.evacuation_center || "—"}</td>
                          <td>{r.goods_type}</td>
                          <td>{r.quantity}</td>
                          <td>{r.date}</td>
                          <td>
                            <span className={`status-badge status-${r.claim_status}`}>{r.status}</span>
                            {r.claimed_at && <div className="relief-received-at">Received {r.claimed_at}</div>}
                          </td>
                          <td>
                            <ReliefActionButtons
                              release={r}
                              busy={updatingReliefId === r.id}
                              onChange={handleReliefStatusChange}
                            />
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8">No relief has been given to households yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
            </article>

            <article className="panel relief-wide" style={{ gridColumn: "1 / -1" }}>
              <h2>Relief Released to {barangay ? `Brgy. ${barangay}` : "Your Barangay"}</h2>
              <p className="panel-note">
                {dashboardData?.relief_released ?? 0} total units released by CSWD. Confirm a release
                as Received once the goods arrive — only Received goods can be given to households.
              </p>
              {reliefStatusError && <p className="donation-form-error">{reliefStatusError}</p>}
                <Paginated items={reliefReleases}>{(pageRows) => (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Tracking No.</th>
                      <th>Evacuation Center</th>
                      <th>Households</th>
                      <th>Goods</th>
                      <th>Qty</th>
                      <th>Date</th>
                      <th>Status</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reliefReleases.length > 0 ? (
                      pageRows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.tracking_number}</td>
                          <td>{r.evacuation_center || "—"}</td>
                          <td>{r.households_served}</td>
                          <td>{r.goods_type}</td>
                          <td>{r.quantity}</td>
                          <td>{r.date}</td>
                          <td>
                            <span className={`status-badge status-${r.claim_status}`}>{r.status}</span>
                            {r.claimed_at && <div className="relief-received-at">Received {r.claimed_at}</div>}
                          </td>
                          <td>
                            {r.claim_status === "claimed" ? (
                              <span className="relief-done">Received</span>
                            ) : (
                              <button
                                type="button"
                                className="action-btn"
                                style={{ padding: "6px 10px", fontSize: "0.8rem" }}
                                disabled={updatingReliefId === r.id}
                                onClick={() => handleReliefStatusChange(r, "claimed")}
                              >
                                {updatingReliefId === r.id ? "Saving…" : "Confirm Received"}
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="8">No relief has been released to {barangay || "this barangay"} yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}</Paginated>
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
                                      <Paginated items={group.records}>{(pageRows) => (
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
                                          {pageRows.map((a, i) => (
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
                                      )}</Paginated>
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
                    {isSubmittingReport ? "Preparing PDF…" : "Generate PDF Report"}
                  </button>
                </div>
              </form>
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