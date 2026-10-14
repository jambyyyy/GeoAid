import { useEffect, useState, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import "./CSWDDashboard.css";
import Sidebar from "../../components/sidebar";
import { Paginated } from "../../components/Pagination";
import { API_URL } from "../../config";
import CashFunds, { FinanceUnlockPanel } from "./CashFunds";
import {
  financeFetch,
  getFinanceToken,
  clearFinanceToken,
  FinanceAuthRequired,
} from "./financeAuth";

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
  "Inventory",
  "Vulnerability Profiles",
  "Households",
  "Evacuation Centers",
  "Donations",
  "Reports",
  "Settings",
];

const FLAG_CLASS = {
  PWD: "flag-pwd",
  Pregnant: "flag-pregnant",
  Elderly: "flag-elderly",
  "Child<5": "flag-child5",
};

const sectionInfo = {
  Dashboard: {
    title: "CSWD Dashboard",
    subtitle:
      "City Social Welfare & Development — Relief & Beneficiary Operations",
  },
  "Relief Distribution": {
    title: "Relief Distribution",
    subtitle:
      "Release relief goods to each barangay's evacuation center and see how many households are inside",
  },
  Inventory: {
    title: "Inventory",
    subtitle: "Everything in storage with its unit — add new items and restock",
  },
  Households: {
    title: "Households",
    subtitle: "Registered households under CSWD monitoring",
  },
  "Vulnerability Profiles": {
    title: "Vulnerability Profiles",
    subtitle:
      "Senior citizens, PWD, pregnant women, and children under 5 — ranked by priority level",
  },
  "Evacuation Centers": {
    title: "Evacuation Centers",
    subtitle: "Monitor occupancy across active evacuation sites",
  },
  Donations: {
    title: "Donations",
    subtitle: "Donated goods available for distribution",
  },
  Reports: {
    title: "Reports",
    subtitle: "Relief, vulnerability, and situation reports",
  },
  Settings: {
    title: "Settings",
    subtitle: "Manage your CSWD account preferences",
  },
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
  const text =
    key === "claimed"
      ? "Received"
      : label ||
        RELIEF_STATUS_OPTIONS.find((o) => o.value === key)?.label ||
        value;
  return <span className={`status-badge status-${key}`}>{text}</span>;
}

// Packs CSWD can build from individual inventory items (Relief Distribution > Pack Builder).
const PACK_TYPE_OPTIONS = [
  { value: "rice pack", label: "Rice Pack" },
  { value: "food pack", label: "Food Pack" },
  { value: "medicine pack", label: "Medicine Pack" },
  { value: "water pack", label: "Water Pack" },
];
const PACK_TYPES = PACK_TYPE_OPTIONS.map((o) => o.value);
// Backward compatibility: older canned-goods inventory categories count as Food Pack.
const asCurrentPack = (value) =>
  value === "canned goods pack" ? "food pack" : value;

// Suggests the pack an item is good for from its name (CSWD can still change it).
// Canned goods (sardines, corned beef, etc.) are ingredients for Food Pack, not a separate pack.
const suggestPack = (name) => {
  const n = (name || "").trim().toLowerCase();
  if (!n) return "";
  const has = (words) => words.some((w) => n.includes(w));
  if (n === "rice" || n.startsWith("rice ")) return "rice pack";
  if (
    has([
      "sardine",
      "corned beef",
      "beef loaf",
      "meat loaf",
      "meatloaf",
      "tuna",
      "mackerel",
      "canned",
      "vienna",
      "luncheon",
      "spam",
      "liver spread",
      "pork and beans",
      "bangus",
      "century",
      "argentina",
      "555",
      "ligo",
    ])
  )
    return "food pack";
  if (
    has([
      "medicine",
      "paracetamol",
      "biogesic",
      "tablet",
      "capsule",
      "syrup",
      "vitamin",
      "antibiotic",
      "amoxicillin",
      "bandage",
      "first aid",
      "alcohol",
      "mask",
      "oresol",
      "betadine",
      "gauze",
      "povidone",
    ])
  )
    return "medicine pack";
  if (n.includes("water")) return "water pack";
  if (
    has([
      "noodle",
      "canton",
      "pancit",
      "instant",
      "biscuit",
      "cracker",
      "coffee",
      "sugar",
      "salt",
      "cooking oil",
      "milk",
      "cereal",
      "oat",
      "bread",
      "egg",
      "soy sauce",
      "vinegar",
      "cup",
    ])
  )
    return "food pack";
  return "";
};
const RICE_MAX_PER_PACK = 10; // kg of rice allowed in one pack
const validPositiveWhole = (value) =>
  /^\d+$/.test(String(value).trim()) &&
  Number.isSafeInteger(Number(value)) &&
  Number(value) > 0;

const PRIORITY_CLASS = {
  High: "priority-high",
  Medium: "priority-medium",
  Low: "priority-low",
};

function CSWDDashboard() {
  const navigate = useNavigate();
  const username = sessionStorage.getItem("geoaid_user") || "CSWD Personnel";

  const [activeItem, setActiveItem] = usePersistedChoice(
    "geoaid_cswd_page",
    "Dashboard",
    (v) => v in sectionInfo,
  );
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
  // Donations tab: "goods" (original form + records) or "cash" (cash donations, purchases, ledger).
  const [donationView, setDonationView] = useState("goods");
  const [unlockForReceive, setUnlockForReceive] = useState(null); // donation id waiting for password confirmation
  const [receivingId, setReceivingId] = useState(null);
  const [receiveError, setReceiveError] = useState("");
  const [donationForm, setDonationForm] = useState({
    donor_name: "",
    contact_num: "",
    goods_type: "",
    good_for: "",
    unit: "pcs",
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

  const [itemForm, setItemForm] = useState({
    name: "",
    unit: "",
    good_for: "",
    quantity: "",
  });
  const [isSubmittingItem, setIsSubmittingItem] = useState(false);
  const [itemFormError, setItemFormError] = useState("");
  const [itemFormSuccess, setItemFormSuccess] = useState("");
  // Restock an item that is already in the inventory (e.g. rice).
  const [restockForm, setRestockForm] = useState({
    goods_type: "",
    quantity: "",
  });
  const [restockError, setRestockError] = useState("");
  const [restockSuccess, setRestockSuccess] = useState("");
  const [isRestocking, setIsRestocking] = useState(false);

  // Manual packing: CSWD adds inventory items to a pack with the + buttons.
  // Stock history filters (Inventory tab)
  const [historyDir, setHistoryDir] = useState("all");
  const [historyItem, setHistoryItem] = useState("all");

  const [manualType, setManualType] = useState("food pack");
  const [manualPacks, setManualPacks] = useState("1");
  const [manualRows, setManualRows] = useState([]); // [{ item_id, quantity_per_pack }]
  // Keep an empty per-pack input editable until the operator enters a new number.
  const [manualEmptyInputs, setManualEmptyInputs] = useState([]);
  const [manualError, setManualError] = useState("");
  const [manualSuccess, setManualSuccess] = useState("");
  const [isManualPacking, setIsManualPacking] = useState(false);

  const [reportForm, setReportForm] = useState({
    title: "",
    content: "",
    disaster_type_id: "",
  });
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const [reportFormError, setReportFormError] = useState("");

  const fetchDashboard = async ({ silent = false } = {}) => {
    try {
      const response = await fetch(`${API_URL}/api/cswd/dashboard/`);

      const data = await response.json();
      if (!response.ok)
        throw new Error(data.message || "Could not load CSWD dashboard.");
      setError("");
      setDashboardData(data);
      setDonationRecords(data.donation_records || []);
      return true;
    } catch (err) {
      console.error(err);
      // Do not erase a working dashboard if a background refresh fails.
      if (!silent) setError("Failed to load dashboard data.");
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  useEffect(() => {
    if (!["Relief Distribution", "Inventory", "Donations"].includes(activeItem))
      return;
    const timer = window.setInterval(() => {
      fetchDashboard({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeItem]);

  const handleLogout = () => {
    sessionStorage.removeItem("geoaid_user");
    sessionStorage.removeItem("geoaid_role");
    sessionStorage.removeItem("geoaid_cswd_page");
    clearFinanceToken();
    navigate("/");
  };

  const handleDonationFieldChange = (field, value) => {
    setDonationFormSuccess("");
    setDonationForm((prev) => {
      const next = { ...prev, [field]: value };
      // Suggest a pack from the item name until CSWD picks one themselves.
      if (
        field === "goods_type" &&
        (prev.good_for === "" || prev.good_for === suggestPack(prev.goods_type))
      ) {
        next.good_for = suggestPack(value);
      }
      return next;
    });
  };

  const handleAddDonation = async (e) => {
    e.preventDefault();
    setDonationFormError("");
    setDonationFormSuccess("");

    if (
      !donationForm.donor_name.trim() ||
      !donationForm.goods_type.trim() ||
      !validPositiveWhole(donationForm.quantity) ||
      !donationForm.unit ||
      !donationForm.donation_date
    ) {
      setDonationFormError(
        "Complete donor name, item, unit, quantity (at least 1), and donation date.",
      );
      return;
    }

    // An item that is already in the inventory keeps its own unit and "good for" pack.
    const existingItem = inventory.find(
      (i) =>
        !i.is_pack &&
        i.label.toLowerCase() === donationForm.goods_type.trim().toLowerCase(),
    );
    if (!existingItem && !donationForm.good_for) {
      setDonationFormError("Choose which pack this item is good for.");
      return;
    }

    setIsSubmittingDonation(true);
    try {
      const response = await fetch(`${API_URL}/api/cswd/donations/add/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...donationForm,
          unit: existingItem ? existingItem.unit : donationForm.unit,
          good_for:
            existingItem && existingItem.good_for
              ? existingItem.good_for
              : donationForm.good_for,
          username,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.success) {
        setDonationFormError(
          data.message || "Could not log this donation. Please try again.",
        );
        return;
      }

      // Refetch so donation records and storage stock reflect the new donation.
      await fetchDashboard({ silent: true });
      setDonationPage(1);
      setDonationFormSuccess(
        data.stored_in_inventory && data.stock
          ? `Donation logged. ${data.donation.quantity} ${data.stock.unit} added to ${data.stock.label} storage — now ${data.stock.quantity} ${data.stock.unit} in storage.`
          : donationForm.status === "pending"
            ? "Donation logged as Pending. It is added to storage once you mark it Received."
            : "Donation logged (not added to storage because it is marked Distributed or has no quantity).",
      );
      setDonationForm({
        donor_name: "",
        contact_num: "",
        goods_type: "",
        good_for: "",
        unit: "pcs",
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

  // Pending -> Received: the server adds the goods to Inventory exactly once.
  const handleReceiveDonation = async (id) => {
    if (!getFinanceToken()) {
      setUnlockForReceive(id);
      return;
    }
    setReceivingId(id);
    setReceiveError("");
    try {
      const { ok, data } = await financeFetch(
        "/api/cswd/finance/donations/receive/",
        { method: "POST", json: { donation_id: id } },
      );
      if (!ok) {
        setReceiveError(
          data.message || "Could not mark this donation as received.",
        );
        return;
      }
      await fetchDashboard({ silent: true });
      setDonationFormSuccess(
        data.added_to_inventory
          ? "Donation marked received and added to Inventory."
          : "Donation marked received.",
      );
    } catch (err) {
      if (err instanceof FinanceAuthRequired) setUnlockForReceive(id);
      else setReceiveError("Unable to connect to the server.");
    } finally {
      setReceivingId(null);
    }
  };

  const handleReliefFieldChange = (field, value) => {
    setReliefFormError("");
    setReliefFormSuccess("");
    setReliefForm((prev) => ({
      ...prev,
      [field]: value,
      // Require the operator to choose the destination and quantity for each new selection.
      ...(field === "barangay" ? { evacuation_center_id: "" } : {}),
      ...(field === "goods_type" ? { quantity: "" } : {}),
    }));
  };

  const handleRecordRelief = async (e) => {
    e.preventDefault();
    if (isSubmittingRelief) return;
    setReliefFormError("");
    setReliefFormSuccess("");

    const selectedStock = (dashboardData?.inventory || []).find(
      (item) =>
        item.is_pack &&
        String(item.goods_type).toLowerCase() === reliefForm.goods_type &&
        Number(item.quantity) > 0,
    );
    const centers = (dashboardData?.evacuation_centers || []).filter(
      (center) => center.barangay === reliefForm.barangay,
    );
    const destination = String(reliefForm.evacuation_center_id);
    const validDestination = centers.length
      ? centers.some((center) => String(center.id) === destination)
      : destination === "barangay-wide";
    const disasterChoice = String(reliefForm.disaster_type_id);
    const validPurpose =
      disasterChoice === "general" ||
      (dashboardData?.disaster_types || []).some(
        (disaster) => String(disaster.id) === disasterChoice,
      );

    if (
      !reliefForm.barangay ||
      !validDestination ||
      !selectedStock ||
      !validPositiveWhole(reliefForm.quantity) ||
      !validPurpose ||
      !reliefForm.remarks.trim()
    ) {
      setReliefFormError(
        "Complete every field: barangay, destination, available finished pack, quantity, release purpose and remarks.",
      );
      return;
    }
    if (Number(reliefForm.quantity) > Number(selectedStock.quantity)) {
      setReliefFormError(
        `Only ${selectedStock.quantity} ${selectedStock.label} available in Inventory. Make more packs first or lower the quantity.`,
      );
      return;
    }

    setIsSubmittingRelief(true);
    try {
      const response = await fetch(`${API_URL}/api/cswd/relief/record/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...reliefForm,
          remarks: reliefForm.remarks.trim(),
          username,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setReliefFormError(
          data.message ||
            "The release was not saved. Check the available stock and required fields.",
        );
        // Stock might have changed on a different CSWD screen; refresh our inventory.
        await fetchDashboard({ silent: true });
        return;
      }

      // Success only after Django has committed BOTH the distribution record
      // and the matching Inventory stock deduction.
      const refreshed = await fetchDashboard({ silent: true });
      const confirmation =
        `Released ${data.relief.quantity} ${data.relief.goods_type} to Brgy. ${data.relief.barangay}` +
        `${data.relief.evacuation_center ? ` (${data.relief.evacuation_center})` : " (barangay-wide)"}` +
        `. Tracking: ${data.relief.tracking_number}. Status: Processing; Barangay will confirm receipt.`;
      setReliefFormSuccess(
        refreshed
          ? confirmation
          : `${confirmation} Stock refresh failed; please reload to see the latest balance.`,
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
      setReliefFormError(
        "Couldn't confirm the server response. Refresh the release list before retrying to avoid duplicate entries.",
      );
    } finally {
      setIsSubmittingRelief(false);
    }
  };

  const postJson = async (path, body) => {
    const response = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, ...body }),
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok && data.success !== false, data };
  };

  const handleItemFieldChange = (field, value) => {
    setItemFormSuccess("");
    setItemForm((prev) => {
      const next = { ...prev, [field]: value };
      if (
        field === "name" &&
        (prev.good_for === "" || prev.good_for === suggestPack(prev.name))
      ) {
        next.good_for = suggestPack(value);
      }
      return next;
    });
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    setItemFormError("");
    setItemFormSuccess("");

    if (
      !itemForm.name.trim() ||
      !itemForm.unit.trim() ||
      (itemForm.quantity !== "" &&
        !/^\d+$/.test(String(itemForm.quantity).trim()))
    ) {
      setItemFormError(
        "Enter item name, unit and a non-negative whole starting quantity.",
      );
      return;
    }
    if (!itemForm.good_for && itemForm.name.trim().toLowerCase() !== "rice") {
      setItemFormError("Choose which pack this item is good for.");
      return;
    }

    setIsSubmittingItem(true);
    try {
      const { ok, data } = await postJson(
        "/api/cswd/inventory/items/add/",
        itemForm,
      );
      if (!ok) {
        if (/already in the inventory/i.test(data.message || "")) {
          // The item exists: send the typed quantity to the Restock form instead.
          setItemFormError(
            `"${itemForm.name.trim()}" is already in the inventory. Use "Restock an Existing Item" below to add more stock.`,
          );
          setRestockForm({
            goods_type: itemForm.name.trim().toLowerCase(),
            quantity: String(itemForm.quantity || ""),
          });
          setRestockError("");
          setRestockSuccess("");
          return;
        }
        setItemFormError(
          data.message || "Could not add this item. Please try again.",
        );
        return;
      }
      await fetchDashboard({ silent: true });
      setItemFormSuccess(
        `${data.item.label} added to the inventory (counted in ${data.item.unit}).`,
      );
      setItemForm({ name: "", unit: "", good_for: "", quantity: "" });
    } catch (err) {
      console.error(err);
      setItemFormError("Unable to connect to the server.");
    } finally {
      setIsSubmittingItem(false);
    }
  };

  const handleRestock = async (e) => {
    e.preventDefault();
    setRestockError("");
    setRestockSuccess("");

    if (!restockForm.goods_type) {
      setRestockError("Select the item to restock.");
      return;
    }
    if (
      !/^\d+$/.test(String(restockForm.quantity).trim()) ||
      Number(restockForm.quantity) < 1
    ) {
      setRestockError("Quantity must be a positive whole number.");
      return;
    }

    setIsRestocking(true);
    try {
      const { ok, data } = await postJson("/api/cswd/relief/stock/add/", {
        goods_type: restockForm.goods_type,
        quantity: Number(restockForm.quantity),
      });
      if (!ok) {
        setRestockError(
          data.message || "Could not restock this item. Please try again.",
        );
        return;
      }
      await fetchDashboard({ silent: true });
      const s = data.stock || {};
      setRestockSuccess(
        `Added ${restockForm.quantity} ${s.unit || ""} to ${s.label || restockForm.goods_type}. Now in storage: ${s.quantity ?? "—"} ${s.unit || ""}.`.replace(
          /\s+/g,
          " ",
        ),
      );
      setRestockForm({ goods_type: "", quantity: "" });
    } catch (err) {
      console.error(err);
      setRestockError("Unable to connect to the server.");
    } finally {
      setIsRestocking(false);
    }
  };

  const handleSetGoodFor = async (item, value) => {
    if (!value || value === item.good_for) return;
    try {
      const { ok, data } = await postJson(
        "/api/cswd/inventory/items/good-for/",
        { item_id: item.id, good_for: value },
      );
      if (!ok) {
        setManualError(
          data.message || "Could not change the pack for this item.",
        );
        return;
      }
      await fetchDashboard({ silent: true });
    } catch (err) {
      console.error(err);
      setManualError("Unable to connect to the server.");
    }
  };

  const manualQty = (itemId) => {
    const r = manualRows.find((x) => String(x.item_id) === String(itemId));
    return r ? r.quantity_per_pack : 0;
  };

  // Rice is counted in kg and limited per pack.
  const maxPerPack = (item) =>
    item.goods_type.toLowerCase() === "rice" ? RICE_MAX_PER_PACK : Infinity;

  const handleManualSet = (item, value) => {
    setManualError("");
    setManualSuccess("");
    let qty = Math.floor(Number(value));
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    qty = Math.min(qty, maxPerPack(item), item.quantity);
    setManualRows((rows) => {
      const others = rows.filter((r) => String(r.item_id) !== String(item.id));
      return qty > 0
        ? [...others, { item_id: item.id, quantity_per_pack: qty }]
        : others;
    });
  };

  const handleManualStep = (item, delta) =>
    handleManualSet(item, manualQty(item.id) + delta);

  // Change the number of this ingredient inside ONE pack (not the total stock).
  // Input can be temporarily empty while editing, but a pack can't be submitted that way.
  const handleManualPerPackChange = (item, raw) => {
    if (raw === "") {
      setManualEmptyInputs((ids) =>
        ids.includes(item.id) ? ids : [...ids, item.id],
      );
      return;
    }
    if (
      !/^\d+$/.test(raw) ||
      Number(raw) < 1 ||
      !Number.isSafeInteger(Number(raw))
    )
      return;
    setManualEmptyInputs((ids) => ids.filter((id) => id !== item.id));
    handleManualSet(item, Number(raw));
  };

  const handleManualPack = async (e) => {
    e.preventDefault();
    setManualError("");
    setManualSuccess("");

    if (manualRows.length === 0) {
      setManualError("Add at least one item with the + button.");
      return;
    }
    if (manualEmptyInputs.length > 0) {
      setManualError(
        "Enter the number of pieces or units of every selected product per pack.",
      );
      return;
    }
    if (!validPositiveWhole(manualPacks)) {
      setManualError("Enter a positive whole number of packs.");
      return;
    }
    const maxPossible = Math.min(
      ...manualRows.map((row) => {
        const stock = (dashboardData?.inventory || []).find(
          (i) => String(i.id) === String(row.item_id),
        );
        return stock && row.quantity_per_pack > 0
          ? Math.floor(stock.quantity / row.quantity_per_pack)
          : 0;
      }),
    );
    if (Number(manualPacks) > maxPossible) {
      setManualError(
        `Inventory can make at most ${maxPossible} packs with these item quantities. Lower the count or restock.`,
      );
      return;
    }

    setIsManualPacking(true);
    try {
      const { ok, data } = await postJson("/api/cswd/pack/manual/", {
        pack_type: manualType,
        packs: manualPacks,
        items: manualRows,
      });
      if (!ok) {
        setManualError(data.message || "Could not make this pack.");
        return;
      }
      await fetchDashboard({ silent: true });
      setManualSuccess(
        `Made ${data.packs} ${data.pack_stock.label.toLowerCase()}${data.packs === 1 ? "" : "s"} — now ${data.pack_stock.quantity} in storage, ready to release.`,
      );
      setManualRows([]);
      setManualEmptyInputs([]);
      setManualPacks("1");
    } catch (err) {
      console.error(err);
      setManualError("Unable to connect to the server.");
    } finally {
      setIsManualPacking(false);
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
        setReportFormError(
          data.message || "Could not generate this report. Please try again.",
        );
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
  // A zero-balance canned-only row may exist in databases created before
  // canned ingredients were folded into Food Pack. Hide that inactive row,
  // but keep any positive legacy inventory and its transaction history.
  const inventory = (dashboardData?.inventory || []).filter(
    (item) =>
      !(
        String(item.goods_type).toLowerCase() === "canned goods pack" &&
        Number(item.quantity) === 0
      ),
  );
  // The finished packs in Inventory are the single source of truth for
  // selectable Goods Types. Raw ingredients are NOT releasable packs.
  // Only the four current pack types are releasable. Older canned-only
  // batches remain in inventory/history but are never silently converted
  // to Food Packs (which can contain additional ingredients).
  const releasablePacks = inventory.filter(
    (item) =>
      item.is_pack &&
      Number(item.quantity) > 0 &&
      PACK_TYPES.includes(String(item.goods_type).toLowerCase()),
  );
  const selectedReleasePack = releasablePacks.find(
    (item) => String(item.goods_type).toLowerCase() === reliefForm.goods_type,
  );
  const availableReleaseQuantity = Number(selectedReleasePack?.quantity || 0);
  const packRecipe = dashboardData?.pack_recipe || [];
  // The Inventory list shows the items CSWD adds. The four built-in pack rows
  // (rice / food / medicine / water pack) stay in the database and keep working
  // (making packs and releasing relief use them) but are not listed here. An old
  // "canned goods pack" row stays visible so its leftover stock can be reconciled.
  const visibleInventory = inventory.filter(
    (i) =>
      !i.is_pack || String(i.goods_type).toLowerCase() === "canned goods pack",
  );
  const manualMaxPacks =
    manualRows.length > 0
      ? Math.min(
          ...manualRows.map((row) => {
            const stock = inventory.find(
              (i) => String(i.id) === String(row.item_id),
            );
            return stock && row.quantity_per_pack > 0
              ? Math.floor(stock.quantity / row.quantity_per_pack)
              : 0;
          }),
        )
      : 0;
  const inventoryHistory = dashboardData?.inventory_history || [];
  const historyItems = [...new Set(inventoryHistory.map((h) => h.item))].sort();
  const filteredHistory = inventoryHistory.filter(
    (h) =>
      (historyDir === "all" || h.direction === historyDir) &&
      (historyItem === "all" || h.item === historyItem),
  );
  // Every individual item (anything that is not itself a pack).
  const packableItems = inventory.filter((i) => !i.is_pack);
  const donationItem = packableItems.find(
    (i) =>
      i.label.toLowerCase() === donationForm.goods_type.trim().toLowerCase(),
  );
  const evacuationCenters = dashboardData?.evacuation_centers || [];
  const allHouseholds = dashboardData?.households || [];
  const barangayRelief = dashboardData?.barangay_relief || [];

  // Evacuation centers (with their household counts) of the barangay
  // picked in the Record Relief form.
  const reliefFormCenters = evacuationCenters.filter(
    (c) => c.barangay === reliefForm.barangay,
  );
  const reliefFormBarangay = barangayRelief.find(
    (b) => b.barangay === reliefForm.barangay,
  );
  const reliefFormCenter = reliefFormCenters.find(
    (center) => String(center.id) === String(reliefForm.evacuation_center_id),
  );
  const hasValidReleaseDestination =
    !!reliefForm.barangay &&
    (reliefFormCenters.length > 0
      ? !!reliefFormCenter
      : reliefForm.evacuation_center_id === "barangay-wide");
  const hasReleasePurpose =
    reliefForm.disaster_type_id === "general" ||
    (dashboardData?.disaster_types || []).some(
      (d) => String(d.id) === String(reliefForm.disaster_type_id),
    );
  const canSubmitRelief = Boolean(
    hasValidReleaseDestination &&
    selectedReleasePack &&
    validPositiveWhole(reliefForm.quantity) &&
    Number(reliefForm.quantity) <= availableReleaseQuantity &&
    hasReleasePurpose &&
    reliefForm.remarks.trim(),
  );

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

  const filteredBarangayRelief =
    selectedBarangay === "All"
      ? barangayRelief
      : barangayRelief.filter((b) => b.barangay === selectedBarangay);

  const filteredEvacuationCenters =
    selectedBarangay === "All"
      ? evacuationCenters
      : evacuationCenters.filter((c) => c.barangay === selectedBarangay);

  const totalDonationPages = Math.max(
    1,
    Math.ceil(donationRecords.length / DONATIONS_PER_PAGE),
  );
  const currentDonationPage = Math.min(donationPage, totalDonationPages);
  const paginatedDonations = donationRecords.slice(
    (currentDonationPage - 1) * DONATIONS_PER_PAGE,
    currentDonationPage * DONATIONS_PER_PAGE,
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
                <span className="stat-value">
                  {dashboardData?.total_households ?? 0}
                </span>
                <span className="stat-label">Total Households</span>
              </article>

              <article className="stat-card stat-danger">
                <span className="stat-value">
                  {dashboardData?.priority_cases ?? 0}
                </span>
                <span className="stat-label">Priority Cases</span>
              </article>

              <article className="stat-card stat-success">
                <span className="stat-value">
                  {dashboardData?.relief_released ?? 0}
                </span>
                <span className="stat-label">Relief Released</span>
              </article>

              <article className="stat-card stat-warning">
                <span className="stat-value">
                  {dashboardData?.donations ?? 0}
                </span>
                <span className="stat-label">Donations Logged</span>
              </article>

              {reliefStock.map((s) => (
                <article key={s.goods_type} className="stat-card stat-info">
                  <span className="stat-value">{s.quantity}</span>
                  <span className="stat-label">
                    {s.label} Left in Storage ({s.unit})
                  </span>
                </article>
              ))}
            </section>

            <section className="content-grid">
              <article className="panel">
                <h2>Recent Relief Releases</h2>
                <Paginated items={reliefDistribution}>
                  {(pageRows) => (
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
                                  <ReliefStatusBadge
                                    value={item.claim_status}
                                    label={item.status}
                                  />
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan="5">
                                No relief releases recorded yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Paginated>
              </article>

              <article className="panel">
                <h2>Quick Actions</h2>
                <div className="action-grid">
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveItem("Relief Distribution")}
                  >
                    Record Relief Distribution
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveItem("Vulnerability Profiles")}
                  >
                    Review Priority Cases
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveItem("Households")}
                  >
                    View Households
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveItem("Evacuation Centers")}
                  >
                    Check Evacuation Centers
                  </button>
                  <button
                    type="button"
                    className="action-btn"
                    onClick={() => setActiveItem("Reports")}
                  >
                    Generate Report
                  </button>
                </div>
              </article>
            </section>
          </>
        )}

        {activeItem === "Relief Distribution" && (
          <section className="content-grid relief-tab cswd-relief-distribution">
            <article className="panel relief-wide">
              <h2>Record Relief Distribution</h2>
              <form className="donation-form" onSubmit={handleRecordRelief}>
                {reliefFormError && (
                  <p className="donation-form-error">{reliefFormError}</p>
                )}
                {reliefFormSuccess && (
                  <p className="panel-note">{reliefFormSuccess}</p>
                )}

                <div className="donation-form-field">
                  <label htmlFor="relief_barangay">Barangay</label>
                  <select
                    id="relief_barangay"
                    required
                    value={reliefForm.barangay}
                    onChange={(e) =>
                      handleReliefFieldChange("barangay", e.target.value)
                    }
                  >
                    <option value="">Select a barangay</option>
                    {BARANGAYS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>

                {reliefForm.barangay && (
                  <div className="donation-form-field">
                    <label htmlFor="relief_evacuation_center_id">
                      Relief Destination (required)
                    </label>
                    <select
                      id="relief_evacuation_center_id"
                      required
                      value={reliefForm.evacuation_center_id}
                      onChange={(e) =>
                        handleReliefFieldChange(
                          "evacuation_center_id",
                          e.target.value,
                        )
                      }
                    >
                      <option value="">Select a destination</option>
                      {reliefFormCenters.length > 0 ? (
                        reliefFormCenters.map((c) => (
                          <option key={c.id} value={String(c.id)}>
                            {c.name} — {c.households_in_center} household
                            {c.households_in_center === 1 ? "" : "s"} inside
                          </option>
                        ))
                      ) : (
                        <option value="barangay-wide">
                          Barangay-wide (no evacuation center registered)
                        </option>
                      )}
                    </select>
                    {reliefFormCenters.length === 0 && (
                      <span className="field-hint">
                        No evacuation center is registered here. Select
                        Barangay-wide to proceed for{" "}
                        {reliefFormBarangay?.registered_households ?? 0}{" "}
                        confirmed household(s).
                      </span>
                    )}
                    {reliefFormCenter && (
                      <p className="panel-note">
                        {reliefFormCenter.households_in_center} household
                        {reliefFormCenter.households_in_center === 1 ? "" : "s"}{" "}
                        · {reliefFormCenter.members_in_center}{" "}
                        {reliefFormCenter.members_in_center === 1
                          ? "person"
                          : "people"}{" "}
                        currently checked in at {reliefFormCenter.name}.
                      </p>
                    )}
                  </div>
                )}

                <div className="donation-form-field">
                  <label htmlFor="relief_goods_type">
                    Goods Type (available finished packs only)
                  </label>
                  <div
                    id="relief_goods_type"
                    className="goods-selection-scroll"
                    role="group"
                    aria-label="Finished packs currently available in Inventory"
                  >
                    {releasablePacks.map((pack) => (
                      <button
                        key={pack.id}
                        type="button"
                        aria-pressed={
                          reliefForm.goods_type ===
                          String(pack.goods_type).toLowerCase()
                        }
                        className={`goods-option ${reliefForm.goods_type === String(pack.goods_type).toLowerCase() ? "selected" : ""}`}
                        onClick={() =>
                          handleReliefFieldChange(
                            "goods_type",
                            String(pack.goods_type).toLowerCase(),
                          )
                        }
                      >
                        <span className="goods-name">{pack.label}</span>
                        <span className="goods-quantity">
                          {pack.quantity} {pack.unit} available
                        </span>
                      </button>
                    ))}
                    {releasablePacks.length === 0 && (
                      <p className="field-hint">
                        No assembled packs are available yet. Make a Pack in
                        Inventory first.
                      </p>
                    )}
                  </div>
                  <span className="field-hint">
                    Goods Types come directly from finished packs in Inventory.
                    Individual canned goods, Pancit Canton and other ingredients
                    must be packed first.
                  </span>
                  {releasablePacks.length === 0 && (
                    <button
                      type="button"
                      className="relief-btn outline"
                      onClick={() => setActiveItem("Inventory")}
                    >
                      Go to Inventory / Make a Pack
                    </button>
                  )}
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_quantity">
                    Quantity of Packs to Release (required)
                  </label>
                  <input
                    id="relief_quantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                    max={
                      selectedReleasePack ? availableReleaseQuantity : undefined
                    }
                    disabled={!selectedReleasePack}
                    value={reliefForm.quantity}
                    onChange={(e) =>
                      handleReliefFieldChange("quantity", e.target.value)
                    }
                    placeholder={
                      selectedReleasePack
                        ? `Up to ${availableReleaseQuantity} packs`
                        : "Select Goods Type first"
                    }
                  />
                </div>

                <p className="stock-availability-note" aria-live="polite">
                  Available in Inventory:{" "}
                  <strong>{availableReleaseQuantity} packs</strong>.
                  {selectedReleasePack &&
                    validPositiveWhole(reliefForm.quantity) && (
                      <>
                        {" "}
                        Remaining after this release:{" "}
                        <strong>
                          {Number(reliefForm.quantity) <=
                          availableReleaseQuantity
                            ? availableReleaseQuantity -
                              Number(reliefForm.quantity)
                            : "Not enough stock"}
                        </strong>
                        .
                      </>
                    )}{" "}
                  The selected finished pack stock is deducted when the release
                  is saved. Barangay can use the goods only after confirming
                  receipt.
                </p>
                <div className="donation-form-field">
                  <label htmlFor="relief_disaster_type_id">
                    Release Purpose / Disaster (required)
                  </label>
                  <select
                    id="relief_disaster_type_id"
                    required
                    value={reliefForm.disaster_type_id}
                    onChange={(e) =>
                      handleReliefFieldChange(
                        "disaster_type_id",
                        e.target.value,
                      )
                    }
                  >
                    <option value="">Select a release purpose</option>
                    <option value="general">
                      General relief (not tied to a disaster)
                    </option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={String(dt.id)}>
                        {dt.name}
                        {dt.status === "closed" ? " (Closed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="relief_remarks">
                    Remarks / Reason (required)
                  </label>
                  <input
                    id="relief_remarks"
                    type="text"
                    required
                    maxLength={255}
                    value={reliefForm.remarks}
                    onChange={(e) =>
                      handleReliefFieldChange("remarks", e.target.value)
                    }
                    placeholder="e.g. Relief for families at the evacuation center"
                  />
                </div>

                <div className="donation-form-actions">
                  <button
                    type="submit"
                    className="action-btn"
                    disabled={isSubmittingRelief || !canSubmitRelief}
                  >
                    {isSubmittingRelief ? "Saving…" : "Record Relief Release"}
                  </button>
                </div>
                {!canSubmitRelief && !isSubmittingRelief && (
                  <p className="field-hint" style={{ gridColumn: "1 / -1" }}>
                    Complete every field above and choose a quantity that does
                    not exceed the finished packs in Inventory.
                  </p>
                )}
              </form>
            </article>

            <article className="panel relief-wide">
              <h2>Relief Releases</h2>
              <p className="panel-note">
                A release stays Processing until the barangay staff confirm on
                their dashboard that they received it. The barangay then gives
                the goods to the households checked in at its evacuation center.
              </p>
              <Paginated items={reliefDistribution}>
                {(pageRows) => (
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
                                  {item.household_code ? (
                                    <>
                                      {item.household} ({item.household_code})
                                      {item.evacuation_center ? (
                                        <div className="relief-received-at">
                                          Brgy. {item.barangay} ·{" "}
                                          {item.evacuation_center}
                                        </div>
                                      ) : null}
                                    </>
                                  ) : (
                                    <>
                                      Brgy. {item.barangay}
                                      {item.evacuation_center ? (
                                        <div className="relief-received-at">
                                          {item.evacuation_center}
                                        </div>
                                      ) : null}
                                    </>
                                  )}
                                </td>
                                <td>
                                  {item.household_code
                                    ? 1
                                    : item.households_served}
                                </td>
                                <td>{item.goods_type}</td>
                                <td>{item.quantity}</td>
                                <td>{item.date}</td>
                                <td>
                                  <ReliefStatusBadge
                                    value={item.claim_status}
                                    label={item.status}
                                  />
                                  {item.claimed_at && (
                                    <div className="relief-received-at">
                                      Received {item.claimed_at}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan="7">
                              No relief releases recorded yet.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paginated>
            </article>

            <article className="panel relief-wide">
              <h2>Barangay Relief Overview</h2>
              <p className="panel-note">
                Relief goes to each barangay's evacuation center. Click a
                barangay to see the households currently inside its center.
              </p>
              <div className="panel-toolbar">
                <label
                  htmlFor="relief-barangay-filter"
                  className="panel-toolbar-label"
                >
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
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <span className="panel-toolbar-count">
                  {filteredBarangayRelief.length} barangay
                  {filteredBarangayRelief.length === 1 ? "" : "s"}
                </span>
              </div>

              <Paginated
                items={filteredBarangayRelief}
                resetKey={selectedBarangay}
              >
                {(pageRows) => (
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
                                onClick={() =>
                                  setExpandedBarangay(
                                    expandedBarangay === b.barangay
                                      ? null
                                      : b.barangay,
                                  )
                                }
                              >
                                <td>
                                  <span className="expand-caret">
                                    {expandedBarangay === b.barangay
                                      ? "▾"
                                      : "▸"}
                                  </span>{" "}
                                  {b.barangay}
                                </td>
                                <td>
                                  {b.evacuation_centers.length > 0
                                    ? b.evacuation_centers
                                        .map((c) => c.name)
                                        .join(", ")
                                    : "—"}
                                </td>
                                <td>
                                  {b.households_in_evacuation}
                                  {b.members_in_evacuation > 0 && (
                                    <span className="relief-received-at">
                                      {" "}
                                      ({b.members_in_evacuation} people)
                                    </span>
                                  )}
                                </td>
                                <td>{b.registered_households}</td>
                                <td>
                                  <span
                                    className={`status-badge status-${String(b.relief_status).toLowerCase().replace(/\s+/g, "-")}`}
                                  >
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
                                        <div
                                          key={c.id}
                                          className="household-detail-col"
                                          style={{ marginBottom: 12 }}
                                        >
                                          <p className="household-detail-label">
                                            {c.name} — {c.households_in_center}{" "}
                                            household
                                            {c.households_in_center === 1
                                              ? ""
                                              : "s"}{" "}
                                            · {c.members_in_center}{" "}
                                            {c.members_in_center === 1
                                              ? "person"
                                              : "people"}{" "}
                                            · {c.occupancy} occupancy
                                          </p>
                                          {c.households.length > 0 ? (
                                            <Paginated items={c.households}>
                                              {(pageRows) => (
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
                                                      <tr
                                                        key={h.household_code}
                                                      >
                                                        <td>
                                                          {h.family_name} Family
                                                          ({h.household_code})
                                                        </td>
                                                        <td>
                                                          {h.purok || "—"}
                                                        </td>
                                                        <td>
                                                          {h.members_present}
                                                        </td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              )}
                                            </Paginated>
                                          ) : (
                                            <p className="household-detail-text">
                                              No households are checked in at
                                              this center right now.
                                            </p>
                                          )}
                                        </div>
                                      ))
                                    ) : (
                                      <p className="household-detail-text">
                                        No evacuation center is set up for{" "}
                                        {b.barangay} yet.
                                      </p>
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
                )}
              </Paginated>
            </article>
          </section>
        )}

        {activeItem === "Inventory" && (
          <section className="content-grid relief-tab cswd-inventory-page">
            <article className="panel relief-wide">
              <h2>Add a New Item</h2>
              <form className="donation-form" onSubmit={handleAddItem}>
                {itemFormError && (
                  <p className="donation-form-error">{itemFormError}</p>
                )}
                {itemFormSuccess && (
                  <p className="panel-note">{itemFormSuccess}</p>
                )}

                <div className="donation-form-field">
                  <label htmlFor="item_name">Item Name</label>
                  <input
                    id="item_name"
                    type="text"
                    required
                    value={itemForm.name}
                    onChange={(e) =>
                      handleItemFieldChange("name", e.target.value)
                    }
                    placeholder="e.g. Canned sardines"
                  />
                </div>

                <div className="donation-form-field">
                  <label htmlFor="item_good_for">Good for</label>
                  <select
                    id="item_good_for"
                    required
                    value={itemForm.good_for}
                    onChange={(e) =>
                      handleItemFieldChange("good_for", e.target.value)
                    }
                  >
                    <option value="">Select pack</option>
                    {PACK_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    Food Pack includes canned goods (sardines, corned beef, beef
                    loaf), noodles, canton, and other food.
                  </span>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="item_unit">Unit</label>
                  <input
                    id="item_unit"
                    type="text"
                    required
                    list="item-unit-options"
                    value={itemForm.unit}
                    onChange={(e) =>
                      handleItemFieldChange("unit", e.target.value)
                    }
                    placeholder="e.g. kg, pcs, liters"
                  />
                  <datalist id="item-unit-options">
                    <option value="kg" />
                    <option value="pcs" />
                    <option value="liters" />
                    <option value="sacks" />
                    <option value="boxes" />
                    <option value="cans" />
                  </datalist>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="item_quantity">
                    Starting Quantity (optional)
                  </label>
                  <input
                    id="item_quantity"
                    type="number"
                    min="0"
                    value={itemForm.quantity}
                    onChange={(e) =>
                      handleItemFieldChange("quantity", e.target.value)
                    }
                    placeholder="0"
                  />
                </div>

                <div className="donation-form-actions">
                  <button
                    type="submit"
                    className="action-btn"
                    disabled={isSubmittingItem}
                  >
                    {isSubmittingItem ? "Saving…" : "Add Item"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel relief-wide">
              <h2>Restock an Existing Item</h2>
              <p className="panel-note">
                Add more stock to an item that is already in the inventory, such
                as rice.
              </p>
              <form className="donation-form" onSubmit={handleRestock}>
                {restockError && (
                  <p className="donation-form-error">{restockError}</p>
                )}
                {restockSuccess && (
                  <p
                    className="panel-note"
                    style={{ color: "#047857", fontWeight: 600 }}
                  >
                    {restockSuccess}
                  </p>
                )}

                <div className="donation-form-field">
                  <label htmlFor="restock_item">Item</label>
                  <select
                    id="restock_item"
                    required
                    value={restockForm.goods_type}
                    onChange={(e) => {
                      setRestockSuccess("");
                      setRestockForm((prev) => ({
                        ...prev,
                        goods_type: e.target.value,
                      }));
                    }}
                  >
                    <option value="">Select item</option>
                    {inventory
                      .filter((i) => !i.is_pack)
                      .map((i) => (
                        <option key={i.id} value={i.goods_type}>
                          {i.label} ({i.quantity} {i.unit} in storage)
                        </option>
                      ))}
                  </select>
                </div>

                <div className="donation-form-field">
                  <label htmlFor="restock_quantity">Quantity to add</label>
                  <input
                    id="restock_quantity"
                    type="number"
                    min="1"
                    required
                    value={restockForm.quantity}
                    onChange={(e) => {
                      setRestockSuccess("");
                      setRestockForm((prev) => ({
                        ...prev,
                        quantity: e.target.value,
                      }));
                    }}
                    placeholder="e.g. 25"
                  />
                </div>

                <div className="donation-form-actions">
                  <button
                    type="submit"
                    className="action-btn"
                    disabled={isRestocking}
                  >
                    {isRestocking ? "Saving…" : "Restock"}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel relief-wide">
              <h2>Make a Pack</h2>
              <p className="panel-note">
                Choose a pack type, then use + in the Inventory list to select
                ingredients. Set how many of EACH product go into ONE pack, then
                choose how many identical packs to make. Canned goods are
                included in Food Pack.
              </p>
              <form onSubmit={handleManualPack}>
                {manualError && (
                  <p className="donation-form-error">{manualError}</p>
                )}
                {manualSuccess && (
                  <p
                    className="panel-note"
                    style={{ color: "#047857", fontWeight: 600 }}
                  >
                    {manualSuccess}
                  </p>
                )}

                <div className="donation-form-field">
                  <label htmlFor="manual_pack_type">Make</label>
                  <select
                    id="manual_pack_type"
                    value={manualType}
                    onChange={(e) => {
                      setManualError("");
                      setManualSuccess("");
                      setManualRows([]);
                      setManualEmptyInputs([]);
                      setManualPacks("1");
                      setManualType(e.target.value);
                    }}
                  >
                    {PACK_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="table-scroll" style={{ marginTop: 10 }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Per Pack</th>
                        <th>Total Needed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {manualRows.length > 0 ? (
                        manualRows.map((r) => {
                          const i = inventory.find((x) => x.id === r.item_id);
                          if (!i) return null;
                          const count = validPositiveWhole(manualPacks)
                            ? Number(manualPacks)
                            : 0;
                          const total = r.quantity_per_pack * count;
                          const short = total > i.quantity;
                          const isEditingEmpty = manualEmptyInputs.includes(
                            r.item_id,
                          );
                          return (
                            <tr key={r.item_id}>
                              <td>
                                {i.label} ({i.unit})
                                <span className="field-hint">
                                  Available: {i.quantity} {i.unit}
                                </span>
                              </td>
                              <td>
                                <div className="donation-form-field">
                                  <input
                                    type="number"
                                    min="1"
                                    step="1"
                                    max={Math.min(i.quantity, maxPerPack(i))}
                                    required
                                    aria-label={`${i.label} quantity in each pack`}
                                    title={`Quantity of ${i.label} in one pack`}
                                    style={{ width: 95, maxWidth: "100%" }}
                                    value={
                                      isEditingEmpty ? "" : r.quantity_per_pack
                                    }
                                    onChange={(e) =>
                                      handleManualPerPackChange(
                                        i,
                                        e.target.value,
                                      )
                                    }
                                    onBlur={() =>
                                      setManualEmptyInputs((ids) =>
                                        ids.filter((id) => id !== r.item_id),
                                      )
                                    }
                                  />
                                </div>
                              </td>
                              <td
                                style={
                                  short
                                    ? { color: "#b91c1c", fontWeight: 700 }
                                    : undefined
                                }
                              >
                                {isEditingEmpty
                                  ? "Enter amount"
                                  : `${total} ${i.unit}`}
                                {short ? " (not enough)" : ""}
                                {!isEditingEmpty && count > 0 && !short && (
                                  <span className="field-hint">
                                    Left after making {count}:{" "}
                                    {i.quantity - total} {i.unit}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan="3">
                            No items added yet. Press + on an item below.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="donation-form-field" style={{ marginTop: 12 }}>
                  <label htmlFor="manual_packs">How many packs to make</label>
                  <span className="field-hint">
                    Maximum complete packs based on ALL selected ingredients:{" "}
                    <strong>{manualMaxPacks}</strong>. The ingredient with the
                    lowest available pack count determines the limit.
                  </span>
                  <input
                    id="manual_packs"
                    type="number"
                    min="1"
                    step="1"
                    max={manualMaxPacks || undefined}
                    required
                    value={manualPacks}
                    onChange={(e) => {
                      setManualError("");
                      setManualSuccess("");
                      setManualPacks(e.target.value);
                    }}
                  />
                </div>

                <div
                  className="donation-form-actions"
                  style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}
                >
                  <button
                    type="button"
                    className="relief-btn outline"
                    onClick={() => {
                      setManualRows([]);
                      setManualEmptyInputs([]);
                      setManualError("");
                      setManualPacks("1");
                    }}
                    disabled={manualRows.length === 0}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="relief-btn outline"
                    onClick={() => {
                      setManualPacks(String(manualMaxPacks));
                      setManualError("");
                      setManualSuccess("");
                    }}
                    disabled={
                      manualRows.length === 0 ||
                      manualMaxPacks === 0 ||
                      manualEmptyInputs.length > 0
                    }
                  >
                    Use Maximum ({manualMaxPacks})
                  </button>
                  <button
                    type="submit"
                    className="action-btn"
                    disabled={
                      isManualPacking ||
                      manualRows.length === 0 ||
                      manualEmptyInputs.length > 0 ||
                      !validPositiveWhole(manualPacks) ||
                      Number(manualPacks) > manualMaxPacks
                    }
                  >
                    {isManualPacking
                      ? "Making…"
                      : `Make ${validPositiveWhole(manualPacks) ? manualPacks + " " : ""}${PACK_TYPE_OPTIONS.find((o) => o.value === manualType)?.label}${Number(manualPacks) === 1 ? "" : "s"}`}
                  </button>
                </div>
              </form>
            </article>

            <article className="panel relief-wide">
              <h2>Inventory</h2>
              <Paginated items={visibleInventory} resetKey={manualType}>
                {(pageRows) => (
                  <div className="table-scroll">
                    <table className="data-table inventory-table">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Good For</th>
                          <th>Unit</th>
                          <th>In Storage</th>
                          <th>Total Stored</th>
                          <th>Total Out</th>
                          <th>Last Stored</th>
                          <th>Last Out</th>
                          <th>Add to Pack</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleInventory.length > 0 ? (
                          pageRows.map((i) => (
                            <tr key={i.id}>
                              <td>
                                {String(i.goods_type).toLowerCase() ===
                                "canned goods pack"
                                  ? "Legacy Canned Goods Pack (old stock; reconcile before use)"
                                  : i.label}
                              </td>
                              <td>
                                {i.is_pack ? (
                                  "—"
                                ) : (
                                  <select
                                    className="good-for-select"
                                    value={asCurrentPack(i.good_for)}
                                    aria-label={`Pack that ${i.label} is good for`}
                                    onChange={(e) =>
                                      handleSetGoodFor(i, e.target.value)
                                    }
                                  >
                                    {!i.good_for && (
                                      <option value="">Not set</option>
                                    )}
                                    {PACK_TYPE_OPTIONS.map((o) => (
                                      <option key={o.value} value={o.value}>
                                        {o.label}
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </td>
                              <td>{i.unit}</td>
                              <td>
                                <strong>{i.quantity}</strong>
                              </td>
                              <td>{i.total_stored}</td>
                              <td>{i.total_out}</td>
                              <td>{i.last_stored || "—"}</td>
                              <td>{i.last_out || "—"}</td>
                              <td>
                                {i.is_pack ? (
                                  "—"
                                ) : (
                                  <div className="stepper">
                                    <button
                                      type="button"
                                      className="relief-btn outline"
                                      aria-label={`Less ${i.label}`}
                                      disabled={manualQty(i.id) <= 0}
                                      onClick={() => handleManualStep(i, -1)}
                                    >
                                      −
                                    </button>
                                    <span className="stepper-value">
                                      {manualQty(i.id)}
                                    </span>
                                    <button
                                      type="button"
                                      className="relief-btn outline"
                                      aria-label={`Add ${i.label} to the pack`}
                                      disabled={
                                        i.quantity <= 0 ||
                                        manualQty(i.id) >=
                                          Math.min(maxPerPack(i), i.quantity)
                                      }
                                      onClick={() => handleManualStep(i, 1)}
                                    >
                                      +
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="9">No items in the inventory yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paginated>
            </article>

            <article className="panel relief-wide">
              <h2>Stock History</h2>
              <p className="panel-note">
                Every time stock goes in (donations, restocks, finished packs)
                or out (used in a pack, released to a barangay), with the date
                and the balance left.
              </p>
              <div className="panel-toolbar history-toolbar">
                <label htmlFor="history-dir" className="panel-toolbar-label">
                  Show:
                </label>
                <select
                  id="history-dir"
                  className="barangay-select"
                  value={historyDir}
                  onChange={(e) => setHistoryDir(e.target.value)}
                >
                  <option value="all">All movements</option>
                  <option value="in">Stored (in)</option>
                  <option value="out">Taken out</option>
                </select>
                <label htmlFor="history-item" className="panel-toolbar-label">
                  Item:
                </label>
                <select
                  id="history-item"
                  className="barangay-select"
                  value={historyItem}
                  onChange={(e) => setHistoryItem(e.target.value)}
                >
                  <option value="all">All items</option>
                  {historyItems.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <Paginated
                items={filteredHistory}
                resetKey={`${historyDir}|${historyItem}`}
              >
                {(pageRows) => (
                  <div className="table-scroll">
                    <table className="data-table stock-history-table">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Item</th>
                          <th>Type</th>
                          <th>Quantity</th>
                          <th>Balance</th>
                          <th>Details</th>
                          <th>By</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.length > 0 ? (
                          pageRows.map((h) => (
                            <tr key={h.id}>
                              <td>{h.date}</td>
                              <td>{h.time}</td>
                              <td>{h.item}</td>
                              <td>
                                <span
                                  className={`status-badge ${h.direction === "in" ? "status-open" : "status-pending"}`}
                                >
                                  {h.reason_label}
                                </span>
                              </td>
                              <td
                                className={
                                  h.direction === "in" ? "qty-in" : "qty-out"
                                }
                              >
                                {h.direction === "in" ? "+" : "−"}
                                {h.quantity} {h.unit}
                              </td>
                              <td>
                                {h.balance_after} {h.unit}
                              </td>
                              <td className="details-cell">
                                {h.details || "—"}
                              </td>
                              <td>{h.recorded_by || "—"}</td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="8">No stock movements yet.</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </Paginated>
            </article>
          </section>
        )}

        {activeItem === "Vulnerability Profiles" && (
          <section className="panel">
            <h2>Vulnerability Profiles</h2>
            <div className="panel-toolbar">
              <label
                htmlFor="priority-barangay-filter"
                className="panel-toolbar-label"
              >
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
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <span className="panel-toolbar-count">
                {filteredHouseholds.length} household
                {filteredHouseholds.length === 1 ? "" : "s"} · highest priority
                first
              </span>
            </div>

            <Paginated items={filteredHouseholds} resetKey={selectedBarangay}>
              {(pageRows) => (
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
                            <td>
                              {h.family_name} Family ({h.id})
                            </td>
                            <td>{h.barangay}</td>
                            <td>{h.purok}</td>
                            <td>
                              {h.flags.length
                                ? h.flags.map((f) => (
                                    <span
                                      key={f}
                                      className={`flag-badge ${FLAG_CLASS[f] || ""}`}
                                      style={{ marginRight: 4 }}
                                    >
                                      {f}
                                    </span>
                                  ))
                                : "—"}
                            </td>
                            <td>
                              <span
                                className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}
                              >
                                {h.priority_level || "Low"}
                              </span>
                            </td>
                            <td>
                              {h.checked_in ? (
                                <span className="status-badge status-present">
                                  {h.checked_in_members.length} @{" "}
                                  {h.checked_in_center}
                                </span>
                              ) : (
                                <span className="status-badge status-checked-out">
                                  Not Checked In
                                </span>
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
              )}
            </Paginated>
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
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <span className="panel-toolbar-count">
                {filteredHouseholds.length} household
                {filteredHouseholds.length === 1 ? "" : "s"}
              </span>
            </div>

            <Paginated items={filteredHouseholds} resetKey={selectedBarangay}>
              {(pageRows) => (
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
                              onClick={() =>
                                setExpandedHousehold(
                                  expandedHousehold === h.id ? null : h.id,
                                )
                              }
                            >
                              <td>
                                <span className="expand-caret">
                                  {expandedHousehold === h.id ? "▾" : "▸"}
                                </span>
                                {h.family_name} Family ({h.id})
                              </td>
                              <td>{h.barangay}</td>
                              <td>{h.purok}</td>
                              <td>{h.members.length}</td>
                              <td>
                                {h.flags.length
                                  ? h.flags.map((f) => (
                                      <span
                                        key={f}
                                        className={`flag-badge ${FLAG_CLASS[f] || ""}`}
                                        style={{ marginRight: 4 }}
                                      >
                                        {f}
                                      </span>
                                    ))
                                  : "—"}
                              </td>
                              <td>
                                <span
                                  className={`priority-badge ${PRIORITY_CLASS[h.priority_level] || ""}`}
                                >
                                  {h.priority_level || "Low"}
                                </span>
                              </td>
                              <td>
                                {h.checked_in ? (
                                  <span className="status-badge status-present">
                                    {h.checked_in_members.length} @{" "}
                                    {h.checked_in_center}
                                  </span>
                                ) : (
                                  <span className="status-badge status-checked-out">
                                    Not Checked In
                                  </span>
                                )}
                              </td>
                              <td>{h.submitted}</td>
                            </tr>

                            {expandedHousehold === h.id && (
                              <tr className="household-detail-row">
                                <td colSpan="8">
                                  <div className="household-detail">
                                    <div className="household-detail-col">
                                      <p className="household-detail-label">
                                        Household Members
                                      </p>
                                      <div className="member-list">
                                        {h.members.map((m, i) => {
                                          const isCheckedIn =
                                            h.checked_in_members?.includes(
                                              m.name,
                                            );
                                          return (
                                            <div
                                              className="member-row"
                                              key={`${m.name}-${i}`}
                                            >
                                              <span className="member-name">
                                                {m.name}
                                              </span>
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
                                      <p className="household-detail-label">
                                        Address
                                      </p>
                                      <p className="household-detail-text">
                                        {h.address}
                                      </p>
                                      {h.checked_in && (
                                        <>
                                          <p
                                            className="household-detail-label"
                                            style={{ marginTop: 14 }}
                                          >
                                            Currently Checked In
                                          </p>
                                          <p className="household-detail-text">
                                            {h.checked_in_members.join(", ")} —
                                            at {h.checked_in_center}
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
              )}
            </Paginated>
          </section>
        )}

        {activeItem === "Evacuation Centers" && (
          <section className="panel">
            <div className="panel-toolbar">
              <label
                htmlFor="evac-barangay-filter"
                className="panel-toolbar-label"
              >
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
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
              <span className="panel-toolbar-count">
                {filteredEvacuationCenters.length} center
                {filteredEvacuationCenters.length === 1 ? "" : "s"}
              </span>
            </div>

            <Paginated
              items={filteredEvacuationCenters}
              resetKey={selectedBarangay}
            >
              {(pageRows) => (
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
                              <span
                                className={`status-badge status-${center.status}`}
                              >
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
              )}
            </Paginated>
          </section>
        )}

        {activeItem === "Donations" && (
          <>
            <div className="panel-toolbar" style={{ cursor: "default" }}>
              <div className="relief-seg">
                <button
                  type="button"
                  className={`relief-seg-btn${donationView === "goods" ? " active" : ""}`}
                  onClick={() => setDonationView("goods")}
                >
                  Goods Donations
                </button>
                <button
                  type="button"
                  className={`relief-seg-btn${donationView === "cash" ? " active" : ""}`}
                  onClick={() => setDonationView("cash")}
                >
                  Cash Donations
                </button>
              </div>
            </div>
            {donationView === "cash" ? (
              <CashFunds
                username={username}
                inventory={dashboardData?.inventory || []}
                disasterTypes={dashboardData?.disaster_types || []}
                onInventoryChanged={() => fetchDashboard({ silent: true })}
              />
            ) : (
              <section className="content-grid">
                {unlockForReceive !== null && (
                  <FinanceUnlockPanel
                    username={username}
                    onUnlocked={() => {
                      const id = unlockForReceive;
                      setUnlockForReceive(null);
                      handleReceiveDonation(id);
                    }}
                  />
                )}
                <article className="panel">
                  <h2>Log a Donation</h2>
                  <form className="donation-form" onSubmit={handleAddDonation}>
                    {donationFormError && (
                      <p className="donation-form-error">{donationFormError}</p>
                    )}
                    {donationFormSuccess && (
                      <p className="panel-note">{donationFormSuccess}</p>
                    )}

                    <div className="donation-form-field">
                      <label htmlFor="donor_name">Donor Name</label>
                      <input
                        id="donor_name"
                        type="text"
                        required
                        value={donationForm.donor_name}
                        onChange={(e) =>
                          handleDonationFieldChange(
                            "donor_name",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. Juan Dela Cruz"
                      />
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="contact_num">
                        Contact Number (optional)
                      </label>
                      <input
                        id="contact_num"
                        type="text"
                        value={donationForm.contact_num}
                        onChange={(e) =>
                          handleDonationFieldChange(
                            "contact_num",
                            e.target.value,
                          )
                        }
                        placeholder="Optional"
                      />
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="goods_type">Item Received</label>
                      <input
                        id="goods_type"
                        type="text"
                        required
                        list="donation-item-options"
                        value={donationForm.goods_type}
                        onChange={(e) =>
                          handleDonationFieldChange(
                            "goods_type",
                            e.target.value,
                          )
                        }
                        placeholder="e.g. Rice, Canned sardines, Noodles, Paracetamol, Water bottle"
                      />
                      <datalist id="donation-item-options">
                        {packableItems.map((i) => (
                          <option key={i.id} value={i.label} />
                        ))}
                      </datalist>
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="donation_good_for">Good for</label>
                      <select
                        id="donation_good_for"
                        value={asCurrentPack(
                          donationItem && donationItem.good_for
                            ? donationItem.good_for
                            : donationForm.good_for,
                        )}
                        disabled={!!(donationItem && donationItem.good_for)}
                        onChange={(e) =>
                          handleDonationFieldChange("good_for", e.target.value)
                        }
                      >
                        <option value="">Select pack</option>
                        {PACK_TYPE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <span className="field-hint">
                        Food Pack includes canned goods (sardines, corned beef,
                        beef loaf), noodles, canton, and other food.
                      </span>
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="donation_unit">Unit</label>
                      <select
                        id="donation_unit"
                        value={
                          donationItem ? donationItem.unit : donationForm.unit
                        }
                        disabled={!!donationItem}
                        onChange={(e) =>
                          handleDonationFieldChange("unit", e.target.value)
                        }
                      >
                        <option value="pcs">Pieces (pcs)</option>
                        <option value="kg">Kilograms (kg)</option>
                        {donationItem &&
                          !["pcs", "kg"].includes(donationItem.unit) && (
                            <option value={donationItem.unit}>
                              {donationItem.unit}
                            </option>
                          )}
                      </select>
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="quantity">
                        Quantity (
                        {donationItem ? donationItem.unit : donationForm.unit})
                      </label>
                      <input
                        id="quantity"
                        type="number"
                        min="1"
                        step="1"
                        required
                        value={donationForm.quantity}
                        onChange={(e) =>
                          handleDonationFieldChange("quantity", e.target.value)
                        }
                        placeholder="e.g. 50"
                      />
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="donation_date">Donation Date</label>
                      <input
                        id="donation_date"
                        type="date"
                        required
                        value={donationForm.donation_date}
                        onChange={(e) =>
                          handleDonationFieldChange(
                            "donation_date",
                            e.target.value,
                          )
                        }
                      />
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="status">Status</label>
                      <select
                        id="status"
                        value={donationForm.status}
                        onChange={(e) =>
                          handleDonationFieldChange("status", e.target.value)
                        }
                      >
                        <option value="pending">Pending</option>
                        <option value="received">Received</option>
                        <option value="distributed">Distributed</option>
                      </select>
                    </div>

                    <div className="donation-form-field">
                      <label htmlFor="disaster_type_id">
                        Disaster Type (optional)
                      </label>
                      <select
                        id="disaster_type_id"
                        value={donationForm.disaster_type_id}
                        onChange={(e) =>
                          handleDonationFieldChange(
                            "disaster_type_id",
                            e.target.value,
                          )
                        }
                      >
                        <option value="">
                          Not tied to a specific disaster
                        </option>
                        {(dashboardData?.disaster_types || []).map((dt) => (
                          <option key={dt.id} value={dt.id}>
                            {dt.name}
                            {dt.status === "closed" ? " (Closed)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="donation-form-actions">
                      <button
                        type="submit"
                        className="action-btn"
                        disabled={isSubmittingDonation}
                      >
                        {isSubmittingDonation ? "Saving…" : "Add Donation"}
                      </button>
                    </div>
                  </form>
                </article>

                <article className="panel">
                  <h2>Donation Records</h2>
                  {receiveError && (
                    <p className="donation-form-error">{receiveError}</p>
                  )}
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
                                onClick={() =>
                                  setExpandedDonation(
                                    expandedDonation === d.id ? null : d.id,
                                  )
                                }
                              >
                                <td>
                                  <span className="expand-caret">
                                    {expandedDonation === d.id ? "▾" : "▸"}
                                  </span>
                                  {d.donor_name}
                                </td>
                                <td>{d.goods_type}</td>
                                <td>
                                  {d.quantity} {d.unit}
                                </td>
                                <td>{d.donation_date}</td>
                                <td>
                                  <span
                                    className={`status-badge status-${d.status}`}
                                  >
                                    {d.status}
                                  </span>
                                  {d.status === "pending" && (
                                    <button
                                      type="button"
                                      className="relief-btn outline"
                                      style={{ marginLeft: 8 }}
                                      disabled={receivingId === d.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleReceiveDonation(d.id);
                                      }}
                                    >
                                      {receivingId === d.id
                                        ? "Saving…"
                                        : "Mark Received"}
                                    </button>
                                  )}
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
                    <div
                      className="panel-toolbar"
                      style={{ marginTop: 14, marginBottom: 0 }}
                    >
                      <button
                        type="button"
                        className="pagination-btn"
                        disabled={currentDonationPage === 1}
                        onClick={() =>
                          setDonationPage((p) => Math.max(1, p - 1))
                        }
                      >
                        Previous
                      </button>
                      <span
                        className="panel-toolbar-count"
                        style={{ marginLeft: 0 }}
                      >
                        Page {currentDonationPage} of {totalDonationPages}
                      </span>
                      <button
                        type="button"
                        className="pagination-btn"
                        disabled={currentDonationPage === totalDonationPages}
                        onClick={() =>
                          setDonationPage((p) =>
                            Math.min(totalDonationPages, p + 1),
                          )
                        }
                        style={{ marginLeft: "auto" }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </article>
              </section>
            )}
          </>
        )}

        {activeItem === "Reports" && (
          <section className="content-grid">
            <article className="panel">
              <h2>Generate Report</h2>
              <form className="donation-form" onSubmit={handleGenerateReport}>
                {reportFormError && (
                  <p className="donation-form-error">{reportFormError}</p>
                )}

                <div className="donation-form-field">
                  <label htmlFor="report_disaster_type_id">Disaster Type</label>
                  <select
                    id="report_disaster_type_id"
                    value={reportForm.disaster_type_id}
                    onChange={(e) =>
                      handleReportFieldChange(
                        "disaster_type_id",
                        e.target.value,
                      )
                    }
                  >
                    <option value="">Not tied to a specific disaster</option>
                    {(dashboardData?.disaster_types || []).map((dt) => (
                      <option key={dt.id} value={dt.id}>
                        {dt.name}
                        {dt.status === "closed" ? " (Closed)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div
                  className="donation-form-field"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <label htmlFor="report_title">Title</label>
                  <input
                    id="report_title"
                    type="text"
                    value={reportForm.title}
                    onChange={(e) =>
                      handleReportFieldChange("title", e.target.value)
                    }
                    placeholder="e.g. Weekly Relief & Vulnerability Report"
                  />
                </div>

                <div
                  className="donation-form-field"
                  style={{ gridColumn: "1 / -1" }}
                >
                  <label htmlFor="report_content">Content</label>
                  <textarea
                    id="report_content"
                    rows={5}
                    value={reportForm.content}
                    onChange={(e) =>
                      handleReportFieldChange("content", e.target.value)
                    }
                    placeholder="Summarize the situation, relief activity, or disaster monitoring findings…"
                  />
                </div>

                <div className="donation-form-actions">
                  <button
                    type="submit"
                    className="action-btn"
                    disabled={isSubmittingReport}
                  >
                    {isSubmittingReport
                      ? "Preparing PDF…"
                      : "Generate PDF Report"}
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
