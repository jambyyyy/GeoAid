"""Cash donations, relief-goods purchasing, receipts and the cash ledger.

Everything money-related lives here so views.py only needs small edits.

Security model
--------------
The existing endpoints trust a `username` sent by the browser. That is NOT
acceptable for money, so every endpoint in this module requires a signed,
expiring bearer token that the server issues only after the CSWD user's real
password is verified (`cswd_finance_unlock`). On every request the token is
re-checked against the database: the user must still exist, be active, still
have the same password, and still be in a CSWD group. The recorded-by name
always comes from the token, never from the request body.

Money rules
-----------
* Only Decimal is used (never float). Amounts are parsed from text/JSON with
  at most 2 decimal places.
* Totals and balances are always recomputed from the database; any total sent
  by the browser is ignored.
* Cash in/out is a ledger (CashTransaction). Balance = sum(in) - sum(out).
* CashFund row 1 is locked with select_for_update() for every money write.
"""

import hashlib
import json
import re
import uuid
from decimal import Decimal

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core import signing
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import IntegrityError, transaction
from django.db.models import Q, Sum
from django.http import FileResponse, Http404, JsonResponse
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt

from .models import (
    CashDonation, CashFund, CashPurchase, CashPurchaseItem, CashTransaction,
    Donation, DisasterType, ReliefStock, PACK_TYPES, _new_code,
)
from .views import (
    GROUP_ROLE_MAP, _clean_good_for, _clean_item_name, _clean_unit,
    _format_ph, _good_for, _log_movement, _stock_for_goods,
    _whole_quantity,
)

TOKEN_SALT = "geoaid.cswd.finance"
TOKEN_MAX_AGE = 8 * 60 * 60          # 8 hours
MAX_RECEIPT_BYTES = 5 * 1024 * 1024  # 5 MB
MAX_PURCHASE_LINES = 50
ZERO = Decimal("0.00")
CENT = Decimal("0.01")

_RECEIPT_TYPES = {
    "jpg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "jpeg": ("image/jpeg", (b"\xff\xd8\xff",)),
    "png": ("image/png", (b"\x89PNG\r\n\x1a\n",)),
    "pdf": ("application/pdf", (b"%PDF-",)),
}


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def _preflight():
    response = JsonResponse({})
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    response["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return response


def _err(message, status=400, **extra):
    return JsonResponse(dict({"success": False, "message": message}, **extra), status=status)


def _role_for_user(user):
    """Same rule login_user uses: role comes from the user's first group."""
    group = user.groups.first()
    if not group:
        return ""
    return GROUP_ROLE_MAP.get(group.name.strip().lower(), "")


def _pw_fingerprint(user):
    return hashlib.sha256((user.password or "").encode()).hexdigest()[:16]


def _issue_token(user):
    return signing.dumps({"u": user.username, "p": _pw_fingerprint(user)}, salt=TOKEN_SALT)


def _authorize(request):
    """Returns (user, None) for an authorised CSWD user, else (None, response)."""
    header = request.META.get("HTTP_AUTHORIZATION", "")
    if not header.startswith("Bearer "):
        return None, _err("Confirm your CSWD password to manage funds.", 401, auth_required=True)
    try:
        data = signing.loads(header[7:].strip(), salt=TOKEN_SALT, max_age=TOKEN_MAX_AGE)
    except signing.BadSignature:  # includes SignatureExpired
        return None, _err("Your finance session expired. Confirm your password again.", 401, auth_required=True)
    user = User.objects.filter(username=data.get("u"), is_active=True).first()
    if not user or data.get("p") != _pw_fingerprint(user):
        return None, _err("Your finance session is no longer valid. Confirm your password again.", 401, auth_required=True)
    if _role_for_user(user) != "cswd":
        return None, _err("Only CSWD personnel can manage funds.", 403)
    return user, None


def _json_body(request):
    try:
        data = json.loads(request.body or "{}")
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _money(raw):
    """Positive Decimal with at most 2 decimals and at most 10 integer digits, else None."""
    if raw is None or isinstance(raw, bool):
        return None
    text = str(raw).strip().replace(",", "")
    if not re.fullmatch(r"\d{1,10}(\.\d{1,2})?", text):
        return None
    value = Decimal(text).quantize(CENT)
    return value if value > 0 else None


def _fmt(d):
    return f"{(d or ZERO).quantize(CENT):.2f}"


def _fund_totals():
    agg = CashTransaction.objects.aggregate(
        received=Sum("amount", filter=Q(kind="in")),
        spent=Sum("amount", filter=Q(kind="out")),
    )
    received = (agg["received"] or ZERO).quantize(CENT)
    spent = (agg["spent"] or ZERO).quantize(CENT)
    return received, spent, (received - spent).quantize(CENT)


def _lock_fund():
    """Serialises every money write. Call inside transaction.atomic()."""
    CashFund.objects.get_or_create(pk=1)
    return CashFund.objects.select_for_update().get(pk=1)


def _parse_uuid(raw):
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError, TypeError):
        return None


def _donation_payload(d):
    return {
        "id": d.id,
        "transaction_code": d.transaction_code,
        "donor_name": d.donor_name,
        "contact_num": d.contact_num,
        "amount": _fmt(d.amount),
        "donation_date": d.donation_date.strftime("%b %d, %Y"),
        "reference_number": d.reference_number,
        "disaster_type": d.disaster_type.disaster_type_name if d.disaster_type else "",
        "remarks": d.remarks,
        "recorded_by": d.recorded_by,
    }


def _purchase_payload(p):
    return {
        "id": p.id,
        "purchase_code": p.purchase_code,
        "supplier_name": p.supplier_name,
        "purchase_date": p.purchase_date.strftime("%b %d, %Y"),
        "receipt_reference": p.receipt_reference,
        "total_cost": _fmt(p.total_cost),
        "remarks": p.remarks,
        "recorded_by": p.recorded_by,
        "receipt_name": p.receipt_original_name,
        "receipt_type": p.receipt_content_type,
        "items": [
            {
                "item_name": i.item_name,
                "quantity": i.quantity,
                "unit": i.unit,
                "unit_price": _fmt(i.unit_price),
                "subtotal": _fmt(i.subtotal),
            }
            for i in p.items.all()
        ],
    }


# --------------------------------------------------------------------------
# unlock (password re-confirmation -> signed token)
# --------------------------------------------------------------------------
@csrf_exempt
def cswd_finance_unlock(request):
    """POST {username, password} -> {token}. Verifies the real Django password
    and that the account is a CSWD account. Failed attempts are rate limited."""
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "POST":
        return _err("POST required.", 405)
    payload = _json_body(request)
    if payload is None:
        return _err("Invalid JSON body.")

    username = str(payload.get("username") or "").strip()
    password = str(payload.get("password") or "")
    if not username or not password:
        return _err("Enter your password.")

    key = "geoaid-finance-unlock:" + hashlib.sha256(username.lower().encode()).hexdigest()[:24]
    if cache.get(key, 0) >= 5:
        return _err("Too many failed attempts. Try again in 15 minutes.", 429)

    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        cache.set(key, cache.get(key, 0) + 1, 15 * 60)
        return _err("Incorrect password.", 401)
    if _role_for_user(user) != "cswd":
        return _err("Only CSWD personnel can manage funds.", 403)
    cache.delete(key)
    return JsonResponse({"success": True, "token": _issue_token(user), "username": user.username,
                         "expires_in": TOKEN_MAX_AGE})


# --------------------------------------------------------------------------
# overview (balances, ledger, histories)
# --------------------------------------------------------------------------
@csrf_exempt
def cswd_finance_overview(request):
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "GET":
        return _err("GET required.", 405)
    user, denied = _authorize(request)
    if denied:
        return denied

    received, spent, remaining = _fund_totals()
    ledger = [
        {
            "id": t.id,
            "date": _format_ph(t.created_at, "%b %d, %Y"),
            "time": _format_ph(t.created_at, "%I:%M %p"),
            "kind": t.kind,
            "kind_label": "Cash in" if t.kind == "in" else "Cash out",
            "amount": _fmt(t.amount),
            "balance_after": _fmt(t.balance_after),
            "reference": (t.donation.transaction_code if t.donation_id else t.purchase.purchase_code),
            "description": t.description,
            "recorded_by": t.recorded_by,
        }
        for t in CashTransaction.objects.select_related("donation", "purchase")[:300]
    ]
    donations = [
        _donation_payload(d)
        for d in CashDonation.objects.select_related("disaster_type")[:300]
    ]
    purchases = [
        _purchase_payload(p)
        for p in CashPurchase.objects.prefetch_related("items")[:300]
    ]
    return JsonResponse({
        "success": True,
        "total_cash_donations": _fmt(received),
        "total_money_spent": _fmt(spent),
        "remaining_funds": _fmt(remaining),
        "ledger": ledger,
        "cash_donations": donations,
        "purchases": purchases,
    })


# --------------------------------------------------------------------------
# cash donation
# --------------------------------------------------------------------------
@csrf_exempt
def cswd_finance_add_cash_donation(request):
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "POST":
        return _err("POST required.", 405)
    user, denied = _authorize(request)
    if denied:
        return denied
    payload = _json_body(request)
    if payload is None:
        return _err("Invalid JSON body.")

    request_id = _parse_uuid(payload.get("request_id"))
    if request_id is None:
        return _err("Missing request id. Reload the page and try again.")

    # Same request sent twice (double click / retry): return the original result.
    existing = CashDonation.objects.select_related("disaster_type").filter(request_id=request_id).first()
    if existing:
        return JsonResponse({"success": True, "duplicate": True, "donation": _donation_payload(existing)})

    donor_name = " ".join(str(payload.get("donor_name") or "").split())
    contact_num = str(payload.get("contact_num") or "").strip()
    reference = " ".join(str(payload.get("reference_number") or "").split())
    remarks = str(payload.get("remarks") or "").strip()

    if not donor_name:
        return _err("Donor name is required.")
    if len(donor_name) > 150:
        return _err("Donor name is too long (150 characters max).")
    if len(contact_num) > 20:
        return _err("Contact number is too long (20 characters max).")
    amount = _money(payload.get("amount"))
    if amount is None:
        return _err("Enter a cash amount greater than zero, with at most 2 decimal places.")
    raw_date = payload.get("donation_date")
    donation_date = parse_date(raw_date) if isinstance(raw_date, str) and raw_date else None
    if not donation_date:
        return _err("Choose the donation date (YYYY-MM-DD).")
    if len(reference) > 60:
        return _err("Reference number is too long (60 characters max).")
    if len(remarks) > 255:
        return _err("Remarks must be 255 characters or fewer.")

    disaster_type = None
    dt_id = payload.get("disaster_type_id")
    if dt_id not in (None, "", "general"):
        disaster_type = DisasterType.objects.filter(id=dt_id).first() if str(dt_id).isdigit() else None
        if disaster_type is None:
            return _err("Selected disaster type was not found.")

    if reference and CashDonation.objects.filter(reference_number__iexact=reference).exists():
        return _err("That transaction/reference number was already recorded.", 409)

    try:
        with transaction.atomic():
            _lock_fund()
            donation = CashDonation.objects.create(
                request_id=request_id, donor_name=donor_name, contact_num=contact_num,
                amount=amount, donation_date=donation_date, reference_number=reference,
                disaster_type=disaster_type, remarks=remarks, recorded_by=user.username,
            )
            _, _, balance = _fund_totals()
            CashTransaction.objects.create(
                kind=CashTransaction.IN, amount=amount, balance_after=balance + amount,
                donation=donation, recorded_by=user.username,
                description=f"Cash donation from {donor_name}"[:255],
            )
    except IntegrityError:
        existing = CashDonation.objects.select_related("disaster_type").filter(request_id=request_id).first()
        if existing:  # a parallel identical request won the race
            return JsonResponse({"success": True, "duplicate": True, "donation": _donation_payload(existing)})
        return _err("That transaction/reference number was already recorded.", 409)
    except Exception:
        return _err("The donation could not be saved. Nothing was recorded.", 500)

    received, spent, remaining = _fund_totals()
    return JsonResponse({
        "success": True, "duplicate": False, "donation": _donation_payload(donation),
        "remaining_funds": _fmt(remaining),
    }, status=201)


# --------------------------------------------------------------------------
# purchase
# --------------------------------------------------------------------------
class _Reject(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status


def _read_receipt(upload):
    """Validates the uploaded receipt; returns (bytes, ext, content_type)."""
    if upload is None:
        raise _Reject("Upload the receipt (JPG, PNG or PDF). It is required.")
    name = (upload.name or "").strip()
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in _RECEIPT_TYPES:
        raise _Reject("Receipt must be a JPG, JPEG, PNG or PDF file.")
    if upload.size <= 0:
        raise _Reject("The receipt file is empty.")
    if upload.size > MAX_RECEIPT_BYTES:
        raise _Reject(f"Receipt is too large (max {MAX_RECEIPT_BYTES // (1024 * 1024)} MB).")
    data = upload.read(MAX_RECEIPT_BYTES + 1)
    content_type, signatures = _RECEIPT_TYPES[ext]
    if len(data) > MAX_RECEIPT_BYTES or not any(data.startswith(sig) for sig in signatures):
        raise _Reject("The receipt file is not a valid JPG, PNG or PDF.")
    return data, ext, content_type


def _parse_lines(raw):
    """Validates the purchased-item lines. Prices/quantities only; no totals."""
    try:
        lines = json.loads(raw or "[]")
    except (json.JSONDecodeError, TypeError):
        raise _Reject("Purchased items are invalid.")
    if not isinstance(lines, list) or not lines:
        raise _Reject("Add at least one purchased item.")
    if len(lines) > MAX_PURCHASE_LINES:
        raise _Reject(f"A purchase can have at most {MAX_PURCHASE_LINES} items.")

    parsed, seen_ids, seen_names = [], set(), set()
    for n, line in enumerate(lines, 1):
        if not isinstance(line, dict):
            raise _Reject(f"Item {n} is invalid.")
        qty = _whole_quantity(line.get("quantity"))
        if qty is None:
            raise _Reject(f"Item {n}: quantity must be a whole number of at least 1.")
        price = _money(line.get("unit_price"))
        if price is None:
            raise _Reject(f"Item {n}: unit price must be greater than zero (max 2 decimals).")
        unit = _clean_unit(line.get("unit"))
        if not unit:
            raise _Reject(f"Item {n}: unit is required.")

        item_id = str(line.get("item_id") or "").strip()
        entry = {"qty": qty, "price": price, "unit": unit,
                 "subtotal": (price * qty).quantize(CENT), "n": n}
        if item_id:
            if not item_id.isdigit():
                raise _Reject(f"Item {n}: choose an item from the inventory.")
            if int(item_id) in seen_ids:
                raise _Reject(f"Item {n}: the same inventory item is listed twice. Combine the quantities.")
            seen_ids.add(int(item_id))
            entry["item_id"] = int(item_id)
            entry["good_for"] = _clean_good_for(line.get("good_for"))
        else:
            name = _clean_item_name(line.get("new_name"))
            good_for = _clean_good_for(line.get("good_for"))
            if not name:
                raise _Reject(f"Item {n}: choose an inventory item or enter a new item name.")
            if len(name) > 100:
                raise _Reject(f"Item {n}: item name is too long (100 characters max).")
            if name.lower() in PACK_TYPES:
                raise _Reject(f"Item {n}: that name is reserved for a pack type.")
            if name.lower() in seen_names:
                raise _Reject(f"Item {n}: the same new item is listed twice.")
            seen_names.add(name.lower())
            if name.lower() == "rice":
                if unit != "kg":
                    raise _Reject(f"Item {n}: rice is counted in kg only.")
                good_for = good_for or "rice pack"
            if not good_for:
                raise _Reject(f"Item {n}: choose which pack this new item is good for (rice, food, medicine or water pack).")
            entry.update(new_name=name, good_for=good_for)
        parsed.append(entry)
    return parsed


@csrf_exempt
def cswd_finance_add_purchase(request):
    """multipart/form-data: request_id, supplier_name, purchase_date,
    receipt_reference, remarks, items (JSON list), receipt (file)."""
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "POST":
        return _err("POST required.", 405)
    user, denied = _authorize(request)
    if denied:
        return denied

    form = request.POST
    request_id = _parse_uuid(form.get("request_id"))
    if request_id is None:
        return _err("Missing request id. Reload the page and try again.")

    existing = CashPurchase.objects.prefetch_related("items").filter(request_id=request_id).first()
    if existing:
        return JsonResponse({"success": True, "duplicate": True, "purchase": _purchase_payload(existing)})

    supplier = " ".join(str(form.get("supplier_name") or "").split())
    or_number = " ".join(str(form.get("receipt_reference") or "").split())
    remarks = str(form.get("remarks") or "").strip()
    raw_date = form.get("purchase_date") or ""
    purchase_date = parse_date(raw_date) if raw_date else None

    if not supplier:
        return _err("Supplier/store name is required.")
    if len(supplier) > 150:
        return _err("Supplier/store name is too long (150 characters max).")
    if not purchase_date:
        return _err("Choose the purchase date (YYYY-MM-DD).")
    if not or_number:
        return _err("Official receipt / reference number is required.")
    if len(or_number) > 60:
        return _err("Receipt/reference number is too long (60 characters max).")
    if len(remarks) > 255:
        return _err("Remarks must be 255 characters or fewer.")

    try:
        lines = _parse_lines(form.get("items"))
        data, ext, content_type = _read_receipt(request.FILES.get("receipt"))
    except _Reject as r:
        return _err(r.message, r.status)

    # Totals are recomputed here from quantity x unit price; any total the
    # browser sent is ignored.
    total = sum((l["subtotal"] for l in lines), ZERO).quantize(CENT)
    if total <= 0:
        return _err("The purchase total must be greater than zero.")

    if CashPurchase.objects.filter(
        supplier_name__iexact=supplier, receipt_reference__iexact=or_number
    ).exists():
        return _err("A purchase with this supplier and receipt number was already recorded.", 409)

    purchase = CashPurchase(
        request_id=request_id, supplier_name=supplier, purchase_date=purchase_date,
        receipt_reference=or_number, total_cost=total, remarks=remarks,
        recorded_by=user.username,
        receipt_original_name=(request.FILES["receipt"].name or "")[:200],
        receipt_content_type=content_type,
    )
    purchase.purchase_code = _new_code("RP")
    stored_name = None
    try:
        with transaction.atomic():
            _lock_fund()
            _, _, balance = _fund_totals()
            if total > balance:
                raise _Reject(
                    f"Not enough available funds. Purchase total is PHP {_fmt(total)} "
                    f"but only PHP {_fmt(balance)} is available.", 400)

            # --- resolve / create inventory rows (locked) ----------------
            resolved = []
            for l in lines:
                if "item_id" in l:
                    stock = ReliefStock.objects.select_for_update().filter(pk=l["item_id"]).first()
                    if stock is None:
                        raise _Reject(f"Item {l['n']}: that inventory item was not found.")
                    if stock.goods_type.lower() in PACK_TYPES:
                        raise _Reject(f"Item {l['n']}: assembled packs cannot be purchased.")
                    if _clean_unit(stock.unit) != l["unit"]:
                        raise _Reject(
                            f"Item {l['n']}: \"{stock.goods_type}\" is counted in {stock.unit} in the "
                            f"inventory, not {l['unit']}.")
                    if l["good_for"] and not _good_for(stock):
                        stock.category = l["good_for"]
                else:
                    if ReliefStock.objects.filter(goods_type__iexact=l["new_name"]).exists():
                        raise _Reject(
                            f"Item {l['n']}: \"{l['new_name']}\" is already in the inventory. Select it from the list.", 409)
                    stock = ReliefStock.objects.create(
                        goods_type=l["new_name"].lower(), unit=l["unit"], quantity=0, category=l["good_for"])
                if stock.quantity + l["qty"] > 2_147_483_647:
                    raise _Reject(f"Item {l['n']}: stock quantity would be too large.")
                resolved.append((l, stock))

            # --- receipt file (cleaned up below if anything fails) --------
            purchase.receipt_file.save(f"{purchase.purchase_code}.{ext}", ContentFile(data), save=False)
            stored_name = purchase.receipt_file.name
            purchase.save()

            # --- purchase items + inventory + movements -------------------
            for l, stock in resolved:
                CashPurchaseItem.objects.create(
                    purchase=purchase, stock=stock, item_name=stock.goods_type, quantity=l["qty"],
                    unit=stock.unit, unit_price=l["price"], subtotal=l["subtotal"])
                stock.quantity += l["qty"]
                stock.save()
                _log_movement(
                    stock, "in", "purchase", l["qty"],
                    f"Purchased from {supplier} (ref {purchase.purchase_code}, OR {or_number})",
                    user.username)

            # --- ledger ---------------------------------------------------
            CashTransaction.objects.create(
                kind=CashTransaction.OUT, amount=total, balance_after=balance - total,
                purchase=purchase, recorded_by=user.username,
                description=f"Relief goods purchase from {supplier} (OR {or_number})"[:255])
    except _Reject as r:
        _cleanup(stored_name)
        return _err(r.message, r.status)
    except IntegrityError:
        _cleanup(stored_name)
        existing = CashPurchase.objects.prefetch_related("items").filter(request_id=request_id).first()
        if existing:
            return JsonResponse({"success": True, "duplicate": True, "purchase": _purchase_payload(existing)})
        return _err("A purchase with this supplier and receipt number was already recorded.", 409)
    except Exception:
        _cleanup(stored_name)
        return _err("The purchase could not be saved. No money or stock was changed.", 500)

    purchase = CashPurchase.objects.prefetch_related("items").get(pk=purchase.pk)
    _, _, remaining = _fund_totals()
    return JsonResponse({
        "success": True, "duplicate": False, "purchase": _purchase_payload(purchase),
        "remaining_funds": _fmt(remaining),
    }, status=201)


def _cleanup(stored_name):
    if not stored_name:
        return
    try:
        CashPurchase._meta.get_field("receipt_file").storage.delete(stored_name)
    except Exception:
        pass


# --------------------------------------------------------------------------
# receipt download (authorised only)
# --------------------------------------------------------------------------
@csrf_exempt
def cswd_finance_receipt(request, purchase_id):
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "GET":
        return _err("GET required.", 405)
    user, denied = _authorize(request)
    if denied:
        return denied
    purchase = CashPurchase.objects.filter(pk=purchase_id).first()
    if purchase is None or not purchase.receipt_file:
        raise Http404("Receipt not found.")
    try:
        handle = purchase.receipt_file.open("rb")
    except FileNotFoundError:
        raise Http404("Receipt file is missing.")
    response = FileResponse(handle, content_type=purchase.receipt_content_type or "application/octet-stream")
    response["Content-Disposition"] = f'inline; filename="{purchase.purchase_code}"'
    response["X-Content-Type-Options"] = "nosniff"
    response["Cache-Control"] = "private, no-store"
    return response


# --------------------------------------------------------------------------
# goods donation: pending -> received (adds to stock exactly once)
# --------------------------------------------------------------------------
@csrf_exempt
def cswd_finance_receive_donation(request):
    """POST {donation_id}: marks a PENDING goods donation as received and, if
    it has not been counted yet, adds it to inventory once."""
    if request.method == "OPTIONS":
        return _preflight()
    if request.method != "POST":
        return _err("POST required.", 405)
    user, denied = _authorize(request)
    if denied:
        return denied
    payload = _json_body(request)
    if payload is None:
        return _err("Invalid JSON body.")
    donation_id = str(payload.get("donation_id") or "")
    if not donation_id.isdigit():
        return _err("Choose a donation.")

    with transaction.atomic():
        donation = Donation.objects.select_for_update().filter(pk=int(donation_id)).first()
        if donation is None:
            return _err("That donation was not found.", 404)
        if donation.status == "received":
            return JsonResponse({"success": True, "already_received": True})
        if donation.status != "pending":
            return _err("Only pending donations can be marked as received.")

        added = False
        if not donation.stock_counted and donation.quantity > 0:
            stock = _stock_for_goods(donation.goods_type, unit=donation.unit)
            stock.quantity += donation.quantity
            stock.save()
            _log_movement(
                stock, "in", "donation", donation.quantity,
                f"Donation from {donation.donor_name} marked received "
                f"({donation.donation_date.strftime('%b %d, %Y')})", user.username)
            donation.stock_counted = True
            added = True
        donation.status = "received"
        donation.save(update_fields=["status", "stock_counted"])
    return JsonResponse({"success": True, "added_to_inventory": added})
