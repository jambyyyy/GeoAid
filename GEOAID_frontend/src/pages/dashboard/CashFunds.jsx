import { useCallback, useEffect, useRef, useState } from "react";
import { Paginated } from "../../components/Pagination";
import { API_URL } from "../../config";
import {
  FinanceAuthRequired, financeFetch, getFinanceToken, newRequestId, unlockFinance,
  toCents, formatPeso, formatCents,
} from "./financeAuth";

const PACK_CHOICES = [
  { value: "rice pack", label: "Rice Pack" },
  { value: "food pack", label: "Food Pack" },
  { value: "medicine pack", label: "Medicine Pack" },
  { value: "water pack", label: "Water Pack" },
];
const isWhole = (v) => /^\d+$/.test(String(v).trim()) && Number.isSafeInteger(Number(v)) && Number(v) > 0;
const blankLine = () => ({ key: Math.random().toString(36).slice(2), item_id: "", new_name: "", good_for: "", unit: "", quantity: "", unit_price: "" });
const blankDonation = () => ({ donor_name: "", contact_num: "", amount: "", donation_date: "", reference_number: "", disaster_type_id: "", remarks: "" });
const blankPurchase = () => ({ supplier_name: "", purchase_date: "", receipt_reference: "", remarks: "" });

// Asks the CSWD user to confirm their password once; the server then issues a
// signed, expiring token used by every money endpoint.
export function FinanceUnlockPanel({ username, onUnlocked }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!password) { setError("Enter your password."); return; }
    setBusy(true); setError("");
    try {
      const res = await unlockFinance(username, password);
      if (!res.ok) { setError(res.message); return; }
      setPassword("");
      onUnlocked();
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="panel panel-wide">
      <h2>Confirm Password</h2>
      <form className="donation-form" onSubmit={submit}>
        {error && <p className="donation-form-error">{error}</p>}
        <div className="donation-form-field">
          <label htmlFor="finance_password">Password for {username}</label>
          <input id="finance_password" type="password" autoComplete="current-password" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        </div>
        <div className="donation-form-actions">
          <button type="submit" className="action-btn" disabled={busy}>{busy ? "Checking…" : "Confirm"}</button>
        </div>
      </form>
    </article>
  );
}

export default function CashFunds({ username, inventory = [], disasterTypes = [], onInventoryChanged }) {
  const [authed, setAuthed] = useState(!!getFinanceToken());
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [donation, setDonation] = useState(blankDonation());
  const donationRequestId = useRef(newRequestId());
  const [donationBusy, setDonationBusy] = useState(false);
  const [donationError, setDonationError] = useState("");
  const [donationOk, setDonationOk] = useState("");

  const [purchase, setPurchase] = useState(blankPurchase());
  const [lines, setLines] = useState([blankLine()]);
  const [receipt, setReceipt] = useState(null);
  const [fileKey, setFileKey] = useState(0);
  const purchaseRequestId = useRef(newRequestId());
  const [purchaseBusy, setPurchaseBusy] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [purchaseOk, setPurchaseOk] = useState("");
  const [expandedPurchase, setExpandedPurchase] = useState(null);

  const stockItems = inventory.filter((i) => !i.is_pack);

  const handleAuthLost = () => { setAuthed(false); setOverview(null); };

  const load = useCallback(async () => {
    try {
      const { ok, data } = await financeFetch("/api/cswd/finance/overview/");
      if (!ok) { setLoadError(data.message || "Could not load cash records."); return; }
      setLoadError(""); setOverview(data);
    } catch (err) {
      if (err instanceof FinanceAuthRequired) handleAuthLost();
      else setLoadError("Unable to connect to the server.");
    }
  }, []);

  useEffect(() => { if (authed) load(); }, [authed, load]);

  // ---------------- cash donation ----------------
  const setDonationField = (k, v) => { setDonationOk(""); setDonation((p) => ({ ...p, [k]: v })); };

  const submitDonation = async (e) => {
    e.preventDefault();
    if (donationBusy) return;
    setDonationError(""); setDonationOk("");
    const cents = toCents(donation.amount);
    if (!donation.donor_name.trim() || !donation.donation_date) { setDonationError("Complete donor name, amount, and donation date."); return; }
    if (!cents || cents <= 0) { setDonationError("Enter a cash amount greater than zero (up to 2 decimal places)."); return; }
    setDonationBusy(true);
    try {
      const { ok, data } = await financeFetch("/api/cswd/finance/cash-donations/add/", {
        method: "POST", json: { ...donation, request_id: donationRequestId.current },
      });
      if (!ok) { setDonationError(data.message || "Could not record this donation."); return; }
      donationRequestId.current = newRequestId();
      setDonation(blankDonation());
      await load();
      setDonationOk(`Cash donation recorded (${data.donation.transaction_code}). Remaining funds: ${formatPeso(data.remaining_funds)}.`);
    } catch (err) {
      if (err instanceof FinanceAuthRequired) { handleAuthLost(); return; }
      // Same request id is kept, so pressing the button again cannot double-record.
      setDonationError("Couldn't confirm the server response. Check Cash Donation History before trying again.");
    } finally {
      setDonationBusy(false);
    }
  };

  // ---------------- purchase ----------------
  const setPurchaseField = (k, v) => { setPurchaseOk(""); setPurchase((p) => ({ ...p, [k]: v })); };
  const setLine = (key, patch) => { setPurchaseOk(""); setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l))); };

  const pickItem = (key, value) => {
    if (value === "new") { setLine(key, { item_id: "new", unit: "", good_for: "" }); return; }
    const item = stockItems.find((i) => String(i.id) === value);
    setLine(key, { item_id: value, new_name: "", unit: item ? item.unit : "", good_for: item && item.good_for ? item.good_for : "" });
  };

  const lineCents = (l) => {
    const p = toCents(l.unit_price);
    return isWhole(l.quantity) && p ? Number(l.quantity) * p : 0;
  };
  const grandCents = lines.reduce((s, l) => s + lineCents(l), 0);

  const submitPurchase = async (e) => {
    e.preventDefault();
    if (purchaseBusy) return;
    setPurchaseError(""); setPurchaseOk("");
    if (!purchase.supplier_name.trim() || !purchase.purchase_date || !purchase.receipt_reference.trim()) {
      setPurchaseError("Complete supplier/store name, purchase date, and official receipt/reference number."); return;
    }
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]; const n = i + 1;
      if (!l.item_id) { setPurchaseError(`Item ${n}: choose an inventory item or add a new one.`); return; }
      if (l.item_id === "new" && (!l.new_name.trim() || !l.good_for)) { setPurchaseError(`Item ${n}: enter the new item's name and the pack it is good for.`); return; }
      if (!l.unit.trim()) { setPurchaseError(`Item ${n}: unit is required.`); return; }
      if (!isWhole(l.quantity)) { setPurchaseError(`Item ${n}: quantity must be a whole number of at least 1.`); return; }
      if (!toCents(l.unit_price) || toCents(l.unit_price) <= 0) { setPurchaseError(`Item ${n}: unit price must be greater than zero.`); return; }
    }
    if (!receipt) { setPurchaseError("Upload the receipt (JPG, PNG or PDF)."); return; }

    const payloadLines = lines.map((l) => (l.item_id === "new"
      ? { new_name: l.new_name, good_for: l.good_for, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price }
      : { item_id: l.item_id, unit: l.unit, quantity: l.quantity, unit_price: l.unit_price, good_for: l.good_for }));
    const form = new FormData();
    form.append("request_id", purchaseRequestId.current);
    Object.entries(purchase).forEach(([k, v]) => form.append(k, v));
    form.append("items", JSON.stringify(payloadLines));
    form.append("receipt", receipt);

    setPurchaseBusy(true);
    try {
      const { ok, data } = await financeFetch("/api/cswd/finance/purchases/add/", { method: "POST", body: form });
      if (!ok) { setPurchaseError(data.message || "Could not record this purchase."); return; }
      purchaseRequestId.current = newRequestId();
      setPurchase(blankPurchase()); setLines([blankLine()]); setReceipt(null); setFileKey((k) => k + 1);
      await load();
      if (onInventoryChanged) await onInventoryChanged();
      setPurchaseOk(`Purchase recorded (${data.purchase.purchase_code}) — ${formatPeso(data.purchase.total_cost)} spent and stock added to Inventory. Remaining funds: ${formatPeso(data.remaining_funds)}.`);
    } catch (err) {
      if (err instanceof FinanceAuthRequired) { handleAuthLost(); return; }
      // The same request id is kept, so resubmitting cannot spend the money twice.
      setPurchaseError("Couldn't confirm the server response. Check Purchase History before trying again.");
    } finally {
      setPurchaseBusy(false);
    }
  };

  const viewReceipt = async (id) => {
    const win = window.open("about:blank", "_blank");
    try {
      const response = await fetch(`${API_URL}/api/cswd/finance/purchases/${id}/receipt/`, {
        headers: { Authorization: `Bearer ${getFinanceToken()}` },
      });
      if (!response.ok) throw new Error("receipt");
      const url = URL.createObjectURL(await response.blob());
      if (win) win.location.href = url; else window.open(url, "_blank");
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      if (win) win.close();
      setLoadError("Could not open that receipt.");
    }
  };

  if (!authed) {
    return (
      <section className="content-grid">
        <FinanceUnlockPanel username={username} onUnlocked={() => setAuthed(true)} />
      </section>
    );
  }

  return (
    <>
      <section className="stats-grid">
        <div className="stat-card stat-info">
          <span className="stat-value">{formatPeso(overview?.total_cash_donations)}</span>
          <span className="stat-label">Total Cash Donations</span>
        </div>
        <div className="stat-card stat-warning">
          <span className="stat-value">{formatPeso(overview?.total_money_spent)}</span>
          <span className="stat-label">Total Money Spent</span>
        </div>
        <div className="stat-card stat-success">
          <span className="stat-value">{formatPeso(overview?.remaining_funds)}</span>
          <span className="stat-label">Remaining Available Funds</span>
        </div>
      </section>
      {loadError && <p className="donation-form-error" style={{ marginBottom: 12 }}>{loadError}</p>}

      <section className="content-grid">
        <article className="panel">
          <h2>Log a Cash Donation</h2>
          <form className="donation-form" onSubmit={submitDonation}>
            {donationError && <p className="donation-form-error">{donationError}</p>}
            {donationOk && <p className="panel-note">{donationOk}</p>}

            <div className="donation-form-field">
              <label htmlFor="cash_donor_name">Donor Name</label>
              <input id="cash_donor_name" type="text" maxLength={150} value={donation.donor_name}
                onChange={(e) => setDonationField("donor_name", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="cash_contact_num">Contact Number (optional)</label>
              <input id="cash_contact_num" type="text" maxLength={20} value={donation.contact_num}
                onChange={(e) => setDonationField("contact_num", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="cash_amount">Cash Amount (₱)</label>
              <input id="cash_amount" type="text" inputMode="decimal" placeholder="0.00" value={donation.amount}
                onChange={(e) => setDonationField("amount", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="cash_donation_date">Donation Date</label>
              <input id="cash_donation_date" type="date" value={donation.donation_date}
                onChange={(e) => setDonationField("donation_date", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="cash_reference">Transaction / Reference Number</label>
              <input id="cash_reference" type="text" maxLength={60} value={donation.reference_number}
                onChange={(e) => setDonationField("reference_number", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="cash_disaster">Disaster Type (optional)</label>
              <select id="cash_disaster" value={donation.disaster_type_id}
                onChange={(e) => setDonationField("disaster_type_id", e.target.value)}>
                <option value="">Not tied to a specific disaster</option>
                {disasterTypes.map((dt) => (
                  <option key={dt.id} value={dt.id}>{dt.name}{dt.status === "closed" ? " (Closed)" : ""}</option>
                ))}
              </select>
            </div>
            <div className="donation-form-field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="cash_remarks">Remarks (optional)</label>
              <input id="cash_remarks" type="text" maxLength={255} value={donation.remarks}
                onChange={(e) => setDonationField("remarks", e.target.value)} />
            </div>
            <div className="donation-form-actions">
              <button type="submit" className="action-btn" disabled={donationBusy}>
                {donationBusy ? "Saving…" : "Add Cash Donation"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel">
          <h2>Transaction Ledger</h2>
          <Paginated items={overview?.ledger || []} resetKey="ledger">{(rows) => (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Date</th><th>Type</th><th>Details</th><th>Amount</th><th>Balance</th></tr>
                </thead>
                <tbody>
                  {rows.length > 0 ? rows.map((t) => (
                    <tr key={t.id}>
                      <td>{t.date}</td>
                      <td><span className={`status-badge ${t.kind === "in" ? "status-completed" : "status-pending"}`}>{t.kind_label}</span></td>
                      <td>{t.description} <span className="field-hint">{t.reference}</span></td>
                      <td>{t.kind === "in" ? "+" : "−"}{formatPeso(t.amount)}</td>
                      <td>{formatPeso(t.balance_after)}</td>
                    </tr>
                  )) : (<tr><td colSpan="5">No cash transactions yet.</td></tr>)}
                </tbody>
              </table>
            </div>
          )}</Paginated>
        </article>

        <article className="panel panel-wide">
          <h2>Purchase Relief Goods</h2>
          <form className="donation-form" onSubmit={submitPurchase}>
            {purchaseError && <p className="donation-form-error">{purchaseError}</p>}
            {purchaseOk && <p className="panel-note">{purchaseOk}</p>}

            <div className="donation-form-field">
              <label htmlFor="pur_supplier">Supplier / Store Name</label>
              <input id="pur_supplier" type="text" maxLength={150} value={purchase.supplier_name}
                onChange={(e) => setPurchaseField("supplier_name", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="pur_date">Purchase Date</label>
              <input id="pur_date" type="date" value={purchase.purchase_date}
                onChange={(e) => setPurchaseField("purchase_date", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="pur_or">Official Receipt / Reference Number</label>
              <input id="pur_or" type="text" maxLength={60} value={purchase.receipt_reference}
                onChange={(e) => setPurchaseField("receipt_reference", e.target.value)} />
            </div>
            <div className="donation-form-field">
              <label htmlFor="pur_by">Recorded By</label>
              <input id="pur_by" type="text" value={username} disabled readOnly />
            </div>
            <div className="donation-form-field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pur_receipt">Receipt (JPG, PNG or PDF, max 5 MB)</label>
              <input key={fileKey} id="pur_receipt" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                onChange={(e) => { setPurchaseOk(""); setReceipt(e.target.files && e.target.files[0] ? e.target.files[0] : null); }} />
            </div>

            <div style={{ gridColumn: "1 / -1" }}>
              {lines.map((l, idx) => {
                const existing = stockItems.find((i) => String(i.id) === l.item_id);
                const isNew = l.item_id === "new";
                return (
                  <div key={l.key} className="pack-builder-row" style={{ marginBottom: 12 }}>
                    <div className="donation-form-field">
                      <label htmlFor={`pur_item_${l.key}`}>Item {idx + 1}</label>
                      <select id={`pur_item_${l.key}`} value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)}>
                        <option value="">Select an item…</option>
                        {stockItems.map((i) => (<option key={i.id} value={i.id}>{i.label} ({i.unit})</option>))}
                        <option value="new">+ New item…</option>
                      </select>
                    </div>
                    {isNew && (
                      <>
                        <div className="donation-form-field">
                          <label htmlFor={`pur_name_${l.key}`}>New Item Name</label>
                          <input id={`pur_name_${l.key}`} type="text" maxLength={100} value={l.new_name}
                            onChange={(e) => setLine(l.key, { new_name: e.target.value })} />
                        </div>
                        <div className="donation-form-field">
                          <label htmlFor={`pur_goodfor_${l.key}`}>Good For</label>
                          <select id={`pur_goodfor_${l.key}`} value={l.good_for} onChange={(e) => setLine(l.key, { good_for: e.target.value })}>
                            <option value="">Select a pack…</option>
                            {PACK_CHOICES.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                          </select>
                        </div>
                      </>
                    )}
                    <div className="donation-form-field">
                      <label htmlFor={`pur_unit_${l.key}`}>Unit</label>
                      <input id={`pur_unit_${l.key}`} type="text" maxLength={20} placeholder="pcs, kg, can…" value={l.unit}
                        disabled={!!existing} onChange={(e) => setLine(l.key, { unit: e.target.value })} />
                    </div>
                    <div className="donation-form-field">
                      <label htmlFor={`pur_qty_${l.key}`}>Quantity</label>
                      <input id={`pur_qty_${l.key}`} type="number" min="1" step="1" value={l.quantity}
                        onChange={(e) => setLine(l.key, { quantity: e.target.value })} />
                    </div>
                    <div className="donation-form-field">
                      <label htmlFor={`pur_price_${l.key}`}>Unit Price (₱)</label>
                      <input id={`pur_price_${l.key}`} type="text" inputMode="decimal" placeholder="0.00" value={l.unit_price}
                        onChange={(e) => setLine(l.key, { unit_price: e.target.value })} />
                    </div>
                    <div className="donation-form-field">
                      <label>Subtotal</label>
                      <input type="text" value={formatCents(lineCents(l))} disabled readOnly />
                    </div>
                    {lines.length > 1 && (
                      <button type="button" className="relief-btn outline" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>Remove</button>
                    )}
                  </div>
                );
              })}
              <div className="pack-builder-row">
                <button type="button" className="relief-btn outline" onClick={() => setLines((ls) => [...ls, blankLine()])}>+ Add Item</button>
                <strong style={{ marginLeft: "auto" }}>Total Purchase: {formatCents(grandCents)}</strong>
              </div>
            </div>

            <div className="donation-form-field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="pur_remarks">Remarks (optional)</label>
              <input id="pur_remarks" type="text" maxLength={255} value={purchase.remarks}
                onChange={(e) => setPurchaseField("remarks", e.target.value)} />
            </div>
            <div className="donation-form-actions">
              <button type="submit" className="action-btn" disabled={purchaseBusy}>
                {purchaseBusy ? "Saving…" : "Record Purchase"}
              </button>
            </div>
          </form>
        </article>

        <article className="panel panel-wide">
          <h2>Purchase History</h2>
          <Paginated items={overview?.purchases || []} resetKey="purchases">{(rows) => (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Reference</th><th>Supplier</th><th>Date</th><th>OR No.</th><th>Total</th><th>Receipt</th></tr>
                </thead>
                <tbody>
                  {rows.length > 0 ? rows.map((p) => (
                    <FragmentRow key={p.id} p={p} open={expandedPurchase === p.id}
                      toggle={() => setExpandedPurchase(expandedPurchase === p.id ? null : p.id)} onView={() => viewReceipt(p.id)} />
                  )) : (<tr><td colSpan="6">No purchases recorded yet.</td></tr>)}
                </tbody>
              </table>
            </div>
          )}</Paginated>
        </article>

        <article className="panel panel-wide">
          <h2>Cash Donation History</h2>
          <Paginated items={overview?.cash_donations || []} resetKey="cash-donations">{(rows) => (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr><th>Reference</th><th>Donor</th><th>Amount</th><th>Date</th><th>Transaction No.</th><th>Details</th></tr>
                </thead>
                <tbody>
                  {rows.length > 0 ? rows.map((d) => (
                    <tr key={d.id}>
                      <td>{d.transaction_code}</td>
                      <td>{d.donor_name}</td>
                      <td>{formatPeso(d.amount)}</td>
                      <td>{d.donation_date}</td>
                      <td>{d.reference_number || "—"}</td>
                      <td>{[d.disaster_type, d.remarks, d.contact_num && `Contact: ${d.contact_num}`, `By ${d.recorded_by}`].filter(Boolean).join(" · ")}</td>
                    </tr>
                  )) : (<tr><td colSpan="6">No cash donations logged yet.</td></tr>)}
                </tbody>
              </table>
            </div>
          )}</Paginated>
        </article>
      </section>
    </>
  );
}

function FragmentRow({ p, open, toggle, onView }) {
  return (
    <>
      <tr className="household-row" onClick={toggle}>
        <td><span className="expand-caret">{open ? "▾" : "▸"}</span>{p.purchase_code}</td>
        <td>{p.supplier_name}</td>
        <td>{p.purchase_date}</td>
        <td>{p.receipt_reference}</td>
        <td>{formatPeso(p.total_cost)}</td>
        <td>
          <button type="button" className="relief-btn outline" onClick={(e) => { e.stopPropagation(); onView(); }}>View</button>
        </td>
      </tr>
      {open && (
        <tr className="household-detail-row">
          <td colSpan="6">
            <table className="data-table">
              <thead><tr><th>Item</th><th>Quantity</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
              <tbody>
                {p.items.map((i, n) => (
                  <tr key={n}>
                    <td>{i.item_name}</td>
                    <td>{i.quantity} {i.unit}</td>
                    <td>{formatPeso(i.unit_price)}</td>
                    <td>{formatPeso(i.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="field-hint">Recorded by {p.recorded_by}{p.remarks ? ` · ${p.remarks}` : ""}</p>
          </td>
        </tr>
      )}
    </>
  );
}
