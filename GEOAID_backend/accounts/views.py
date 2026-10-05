from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q, Sum, ProtectedError, RestrictedError
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt
from zoneinfo import ZoneInfo
import json
import uuid

from .models import (
    Household, FamilyMember, EvacuationCenter, Attendance, Donation, Barangay,
    EvacuationRoute, ReliefStock, ReliefDistribution,
    goods_label, GOODS_TYPES, DisasterType, Report,
    VulnerabilityProfile, sync_vulnerability_profile, priority_from_flags,
)
from . import routing
import re
import io
from xml.sax.saxutils import escape
from django.http import HttpResponse
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle,
    KeepTogether,
)

# Explicit conversion to Philippine time — done here rather than relying
# solely on settings.py's TIME_ZONE, so attendance timestamps display
# correctly in PH time (UTC+8) even if the server itself runs in UTC or
# another zone. Datetimes are still stored as timezone-aware UTC in the
# database either way (Django/timezone.now() default) — only the display
# formatting below is affected.
PH_TZ = ZoneInfo("Asia/Manila")


def _to_ph(dt):
    """Converts an aware datetime to Philippine time, or returns None."""
    if not dt:
        return None
    return timezone.localtime(dt, PH_TZ)


def _format_ph(dt, fmt="%b %d, %Y %I:%M %p"):
    """Formats a datetime in Philippine time. Returns '' if dt is None."""
    ph = _to_ph(dt)
    return ph.strftime(fmt) if ph else ""


def _cors_preflight():
    response = JsonResponse({})
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    response["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"
    return response


# Maps a user's Django group name (lowercased) to the role code the
# frontend uses ("barangay", "cswd", "drrm", "purok"). Add/adjust
# entries here to match whatever your actual group names are.
GROUP_ROLE_MAP = {
    "barangay staff": "barangay",
    "barangay": "barangay",
    "cswd": "cswd",
    "cswd personnel": "cswd",
    "drrm officer": "drrm",
    "drrm": "drrm",
    "purok president": "purok",
    "purok": "purok",
}


def _match_barangay(value):
    """Match free text against the Barangay table, case-insensitively.
    Returns the canonical barangay name (e.g. 'Abuno'), or '' if no match."""

    value = (value or "").strip().lower()
    for name in Barangay.objects.values_list("barangay_name", flat=True):
        if name.lower() == value:
            return name
    return ""


def _barangay_for_username(username):
    """Looks up a staff username's Django user and matches their First
    Name (Django admin > Users) against the Barangay table.
    This is how a Purok President's dashboard gets scoped to their own
    barangay — using only the username the frontend already has in
    sessionStorage, so no extra login-page wiring is needed."""

    username = (username or "").strip()
    if not username:
        return ""
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return ""
    return _match_barangay(user.first_name)


def _purok_for_username(username, barangay=None):
    """Looks up a staff username's Django user and matches their Last
    Name (Django admin > Users) against the purok/zone list for their
    barangay. Mirrors _barangay_for_username, but for the purok a
    Purok President account is scoped to (set by
    `create_purok_presidents`). Returns '' if the account isn't
    scoped to a specific purok (e.g. legacy accounts created before
    per-purok scoping)."""

    username = (username or "").strip()
    if not username:
        return ""
    try:
        user = User.objects.get(username=username)
    except User.DoesNotExist:
        return ""

    barangay = barangay or _match_barangay(user.first_name)
    if not barangay:
        return ""

    last_name = (user.last_name or "").strip().lower()
    if not last_name:
        return ""

    for purok in Household.PUROK_CHOICES_BY_BARANGAY.get(barangay, []):
        if purok.strip().lower() == last_name:
            return purok
    return ""


@csrf_exempt
def login_user(request):

    # Handle CORS preflight
    if request.method == "OPTIONS":
        response = JsonResponse({})
        response["Access-Control-Allow-Origin"] = "*"
        response["Access-Control-Allow-Headers"] = "Content-Type"
        response["Access-Control-Allow-Methods"] = "POST, OPTIONS"
        return response

    if request.method != "POST":
        return JsonResponse(
            {"message": "POST request required"},
            status=405
        )

    try:
        data = json.loads(request.body)

        username = data.get("username")
        password = data.get("password")
        submitted_role = (data.get("role") or "").strip().lower()

        user = authenticate(
            username=username,
            password=password
        )

        if user:

            # Determine the user's ACTUAL role from their Django group.
            # This is the source of truth — never trust the role sent
            # by the client on its own.
            groups = user.groups.all()

            actual_role = ""

            if groups.exists():
                group_name = groups.first().name.strip().lower()
                actual_role = GROUP_ROLE_MAP.get(group_name, "")

            if not actual_role:
                return JsonResponse({
                    "success": False,
                    "message": "This account is not assigned to a recognized role."
                }, status=403)

            if submitted_role and submitted_role != actual_role:
                return JsonResponse({
                    "success": False,
                    "message": "This account is not registered under the selected role."
                }, status=403)

            barangay_assignment = ""
            purok_assignment = ""
            if actual_role == "purok":
                # Barangay is stored on the user's First Name field, and
                # (for accounts created via `create_purok_presidents`)
                # the specific purok/zone is stored on Last Name — both
                # in Django admin > Users. A Purok President can still
                # log in even if these aren't set yet.
                barangay_assignment = _match_barangay(user.first_name)
                purok_assignment = _purok_for_username(user.username, barangay_assignment)

            response_payload = {
                "success": True,
                "username": user.username,
                "role": actual_role,
            }
            if actual_role == "purok":
                response_payload["barangay"] = barangay_assignment
                response_payload["purok"] = purok_assignment

            return JsonResponse(response_payload)

        return JsonResponse({
            "success": False,
            "message": "Invalid username or password"
        }, status=401)

    except Exception as e:
        return JsonResponse({
            "success": False,
            "message": str(e)
        }, status=500)


def _serialize_households(households_qs):
    """Shared household -> JSON shape used by every staff dashboard
    (Purok, Barangay, CSWD, DRRM) so a resident's registration renders
    identically everywhere it appears."""

    households_list = list(households_qs)
    household_ids = [h.id for h in households_list]

    # One query for every household's currently-present Attendance
    # records (not one query per household), then grouped in Python.
    present_by_household = {}
    for a in (
        Attendance.objects
        .filter(household_id__in=household_ids, attendance_status="Present")
        .select_related("family_member", "evacuation_center")
    ):
        present_by_household.setdefault(a.household_id, []).append(a)

    households = []
    for h in households_list:
        flags = set()
        member_payload = []

        for m in h.family_members.all():
            tag = None
            if m.is_pwd:
                flags.add("PWD")
                tag = f"PWD - {m.pwd_detail}" if m.pwd_detail else "PWD"
            if m.is_pregnant:
                flags.add("Pregnant")
                tag = f"Pregnant - {m.pregnant_detail}" if m.pregnant_detail else "Pregnant"
            if m.is_elderly:
                flags.add("Elderly")
            if m.is_child_under5:
                flags.add("Child<5")

            member_payload.append({
                "name": m.full_name,
                "relation": m.relation,
                "age": m.age,
                "tag": tag,
            })

        # Priority classification from vulnerability flags. This is a
        # starting point, not a formula from a fixed spec — PWD/Pregnant
        # count double since those usually need more direct assistance
        # than the other groups. Weights live in models.py.
        # Same formula that VulnerabilityProfile stores (see models.py).
        priority_score, priority_level = priority_from_flags(flags)

        present_records = present_by_household.get(h.id, [])
        checked_in = len(present_records) > 0
        # Assumes one evacuation center per check-in event (a household
        # doesn't split across centers) — takes the first record's center.
        checked_in_center = present_records[0].evacuation_center.name if present_records else None
        checked_in_members = [a.family_member.full_name for a in present_records]

        households.append({
            "id": h.household_code,
            "family_name": h.full_name.split(" ")[-1] if h.full_name else "Household",
            "flags": sorted(flags),
            "address": h.address_line or "Address not provided",
            "purok": h.purok or "—",
            "barangay": h.barangay or "—",
            "gps_lat": h.gps_lat,
            "gps_lng": h.gps_lng,
            "submitted": _format_ph(h.created_at, "%b %d, %Y · %I:%M %p"),
            "status": h.status,
            "members": member_payload,
            "priority_score": priority_score,
            "priority_level": priority_level,
            "checked_in": checked_in,
            "checked_in_center": checked_in_center,
            "checked_in_members": checked_in_members,
        })

    return households


def _priority_beneficiary_counts(households_qs):
    """Aggregate vulnerability counts (senior citizens, PWD, pregnant,
    children<5) across every FamilyMember in the given Household
    queryset. Shared by CSWD (city-wide) and DRRM (city-wide) dashboards."""

    members = FamilyMember.objects.filter(household__in=households_qs)
    return {
        "senior_citizens": members.filter(age__gte=60).count(),
        "pwd": members.filter(is_pwd=True).count(),
        "pregnant": members.filter(is_pregnant=True).count(),
        "children": members.filter(age__lt=5).count(),
    }


def _household_priorities(household_ids):
    """{household_id: {"flags": [...], "priority_score": n, "priority_level": "High"}}
    from the members' vulnerability flags — the same formula as
    VulnerabilityProfile (models.priority_from_flags). One query for all
    households."""
    flag_sets = {hid: set() for hid in household_ids}
    for m in FamilyMember.objects.filter(household_id__in=household_ids):
        fl = flag_sets[m.household_id]
        if m.is_pwd:
            fl.add("PWD")
        if m.is_pregnant:
            fl.add("Pregnant")
        if m.is_elderly:
            fl.add("Elderly")
        if m.is_child_under5:
            fl.add("Child<5")
    out = {}
    for hid, fl in flag_sets.items():
        score, level = priority_from_flags(fl)
        out[hid] = {"flags": sorted(fl), "priority_score": score, "priority_level": level}
    return out


def _center_household_stats(center_ids):
    """For each evacuation center id: the households currently checked in
    (Attendance status 'Present'), with how many of their members are
    present. Returns {center_id: [ {household_code, family_name,
    barangay, purok, members_present}, ... ]} — the CSWD "households in
    this evacuation center" view."""

    by_center = {}
    rows = (
        Attendance.objects
        .filter(evacuation_center_id__in=center_ids, attendance_status="Present")
        .select_related("household")
    )
    for a in rows:
        hh = by_center.setdefault(a.evacuation_center_id, {})
        entry = hh.setdefault(a.household_id, {
            "household_code": a.household.household_code,
            "family_name": (a.household.full_name.split(" ")[-1] if a.household.full_name else a.household.household_code),
            "barangay": a.household.barangay,
            "purok": a.household.purok,
            "members_present": 0,
        })
        entry["members_present"] += 1

    # Vulnerability priority for every household inside a center, and the
    # list ordered most-vulnerable first so they are served first.
    all_ids = {hid for hh in by_center.values() for hid in hh}
    prio = _household_priorities(all_ids)
    result = {}
    for cid, hh in by_center.items():
        for hid, entry in hh.items():
            entry.update(prio.get(hid, {"flags": [], "priority_score": 0, "priority_level": "Low"}))
        result[cid] = sorted(
            hh.values(), key=lambda e: (-e["priority_score"], e["family_name"])
        )
    return result


def _households_in_center(center):
    """Number of distinct households currently checked in at a center."""
    return (
        Attendance.objects
        .filter(evacuation_center=center, attendance_status="Present")
        .values("household_id").distinct().count()
    )


def _barangay_relief_overview(centers_payload):
    """One row per barangay for the CSWD Relief Distribution tab: its
    evacuation center(s), how many households are inside them, how many
    confirmed households the barangay has, and the barangay's relief
    release totals (cancelled releases ignored)."""

    registered = {
        row["barangay"]: row["n"]
        for row in (
            Household.objects.filter(registration_complete=True, status="confirmed")
            .values("barangay").annotate(n=Count("id"))
        )
    }

    releases = {}
    for r in (
        ReliefDistribution.objects
        .filter(household__isnull=True, barangay__isnull=False)
        .exclude(claim_status="cancelled")
        .select_related("barangay")
        .order_by("-distribution_date", "-id")
    ):
        releases.setdefault(r.barangay.barangay_name, []).append(r)

    centers_by_barangay = {}
    for c in centers_payload:
        centers_by_barangay.setdefault(c["barangay"], []).append(c)

    names = list(Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True))
    overview = []
    for name in names:
        recs = releases.get(name, [])
        centers = centers_by_barangay.get(name, [])
        claimed = [r for r in recs if r.claim_status == "claimed"]
        if any(r.claim_status == "ready" for r in recs):
            status = "Ready for Pickup"
        elif any(r.claim_status in ("processing", "pending") for r in recs):
            status = "Processing"
        elif claimed:
            status = "Relief Given"
        else:
            status = "Not Yet Given"
        last = recs[0] if recs else None
        overview.append({
            "barangay": name,
            "evacuation_centers": centers,
            "households_in_evacuation": sum(c["households_in_center"] for c in centers),
            "members_in_evacuation": sum(c["members_in_center"] for c in centers),
            "registered_households": registered.get(name, 0),
            "relief_status": status,
            "releases": len(recs),
            "quantity_released": sum(r.quantity_given for r in recs),
            "last_goods": last.get_goods_type_display() if last else "",
            "last_quantity": last.quantity_given if last else 0,
            "last_date": _format_ph(last.distribution_date, "%b %d, %Y") if last else "",
        })
    return overview


@csrf_exempt
def cswd_dashboard(request):
    """City-wide CSWD view of every household that has cleared the full
    Purok President -> Barangay Staff review chain (status='confirmed').
    Relief releases are made per barangay (to its evacuation center) and
    backed by ReliefDistribution, and current
    relief-goods stock (rice / pack) by ReliefStock — see
    cswd_record_relief and cswd_add_relief_stock below. Donations are
    backed by the Donation model (CSWD logs each drop-off themselves
    from the Donations tab — see cswd_add_donation below)."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    confirmed_qs = (
        Household.objects
        .filter(registration_complete=True, status="confirmed")
        .prefetch_related("family_members")
        .order_by("-created_at")
    )

    priority = _priority_beneficiary_counts(confirmed_qs)
    priority_cases = confirmed_qs.filter(
        Q(family_members__is_pwd=True)
        | Q(family_members__is_pregnant=True)
        | Q(family_members__age__gte=60)
        | Q(family_members__age__lt=5)
    ).distinct().count()

    # Recent relief releases, newest first — replaces the old placeholder
    # that just listed every confirmed household as "Registered".
    relief_qs = (
        ReliefDistribution.objects
        .select_related("household", "disaster_type", "evacuation_center", "barangay")
        .order_by("-distribution_date")[:50]
    )
    relief_distribution = []
    for r in relief_qs:
        if r.household:  # legacy per-household release
            barangay = r.household.barangay or "Unspecified"
            target = (r.household.full_name.split(" ")[-1] + " Family") if r.household.full_name else r.household.household_code
        else:
            barangay = r.barangay.barangay_name if r.barangay else "Unspecified"
            target = f"Brgy. {barangay}"
        relief_distribution.append({
            "id": r.id,
            "household_code": r.household.household_code if r.household else "",
            "household": target,
            "barangay": barangay,
            "evacuation_center": r.evacuation_center.name if r.evacuation_center else "",
            "households_served": r.households_served,
            "goods_type": r.get_goods_type_display(),
            "quantity": r.quantity_given,
            "status": r.get_claim_status_display(),
            "claim_status": r.claim_status,
            "tracking_number": r.tracking_number,
            "remarks": r.remarks,
            "date": _format_ph(r.distribution_date, "%b %d, %Y"),
            "claimed_at": _format_ph(r.claimed_at, "%b %d, %Y %I:%M %p"),
        })

    # Current relief-goods stock — what's actually left in storage. Only
    # two types exist: rice and pack (a pack holds all the other goods).
    # Both rows are created at zero if missing; cswd_add_relief_stock
    # restocks, cswd_record_relief deducts.
    for g in GOODS_TYPES:
        if not ReliefStock.objects.filter(goods_type__iexact=g).exists():
            ReliefStock.objects.create(goods_type=g, quantity=0)
    relief_stock = [
        {"goods_type": s.goods_type, "label": s.get_goods_type_display(), "quantity": s.quantity}
        for s in sorted(
            (s for s in ReliefStock.objects.all() if s.goods_type.lower() in GOODS_TYPES),
            key=lambda s: GOODS_TYPES.index(s.goods_type.lower()),
        )
    ]

    from .models import DisasterType

    donations_qs = Donation.objects.select_related("disaster_type").all()
    donation_records = [
        {
            "id": d.id,
            "donor_name": d.donor_name,
            "contact_num": d.contact_num,
            "goods_type": d.goods_type,
            "quantity": d.quantity,
            "donation_date": d.donation_date.strftime("%b %d, %Y") if d.donation_date else "",
            "status": d.status,
            "disaster_type": d.disaster_type.disaster_type_name if d.disaster_type else "",
        }
        for d in donations_qs
    ]

    disaster_types = [
        {"id": dt.id, "name": dt.disaster_type_name, "status": dt.status}
        for dt in DisasterType.objects.order_by("-start_date", "disaster_type_name")
    ]

    all_centers = list(EvacuationCenter.objects.all().order_by("barangay", "name"))
    present_by_center = _center_household_stats([c.id for c in all_centers])
    centers_payload = []
    for c in all_centers:
        present = present_by_center.get(c.id, [])
        centers_payload.append({
            "id": c.id,
            "name": c.name,
            "barangay": c.barangay,
            "occupancy": f"{c.current_occupancy} / {c.capacity}",
            "occupancy_pct": round((c.current_occupancy / c.capacity) * 100) if c.capacity else 0,
            "status": c.status,
            # Households / people currently checked in at this center.
            "households_in_center": len(present),
            "members_in_center": sum(h["members_present"] for h in present),
            "households": sorted(present, key=lambda h: h["family_name"]),
        })

    data = {
        "total_households": confirmed_qs.count(),
        "priority_cases": priority_cases,
        # Total packs handed out across every release on record (not
        # what's left — that's relief_stock below).
        # Barangay batches + legacy direct releases only — what barangays
        # later hand out to households is part of those batches, so it is
        # not counted again here.
        "relief_released": (
            ReliefDistribution.objects.filter(Q(household__isnull=True) | Q(barangay__isnull=True))
            .exclude(claim_status="cancelled")
            .aggregate(total=Sum("quantity_given"))["total"] or 0
        ),
        "donations": donations_qs.count(),

        "relief_distribution": relief_distribution,
        "relief_stock": relief_stock,
        "priority_beneficiaries": priority,
        "donation_records": donation_records,
        "disaster_types": disaster_types,
        # Sourced from the Barangay table (Django admin > Barangays), not
        # hardcoded — lets the "All Barangays" filter on the CSWD panel
        # stay in sync with whatever barangays actually exist.
        "barangays": list(Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)),

        "evacuation_centers": centers_payload,
        # One row per barangay: its evacuation center(s), households
        # currently inside them, and the barangay's relief status.
        "barangay_relief": _barangay_relief_overview(centers_payload),

        "households": _serialize_households(confirmed_qs),
    }

    return JsonResponse(data)


def _clean_goods_name(text):
    """Normalises a goods type to "rice" or "pack" (case/space
    insensitive). Returns "" for anything else, so callers can reject it."""
    name = " ".join((text or "").split()).lower()
    return name if name in GOODS_TYPES else ""


def _stock_for_goods(goods_name, create=True):
    """Finds the storage row (ReliefStock) for a goods type, matching
    case-insensitively so "can goods" and "Can Goods" are one item. Creates
    a new row for a goods type that has never been stored before.
    Call inside transaction.atomic() so the row is locked."""
    stock = ReliefStock.objects.select_for_update().filter(goods_type__iexact=goods_name).first()
    if stock is None and create:
        stock = ReliefStock.objects.create(goods_type=goods_name, quantity=0)
    return stock


@csrf_exempt
def cswd_add_donation(request):
    """Lets CSWD staff log a donation drop-off themselves from the
    Donations tab — this is manual data entry (there's no donor-facing
    form), so the only validation here is "did they fill in the
    required fields", not identity/ownership checks."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    donor_name = (payload.get("donor_name") or "").strip()
    goods_type = (payload.get("goods_type") or "").strip()
    quantity = payload.get("quantity")
    status = (payload.get("status") or "pending").strip()

    goods_name = _clean_goods_name(goods_type)
    if not donor_name or not goods_type:
        return JsonResponse({"message": "Donor name and goods type are required."}, status=400)
    if not goods_name:
        return JsonResponse({"message": "Goods type must be Rice or Pack."}, status=400)

    try:
        quantity = int(quantity)
        if quantity < 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Quantity must be a non-negative number."}, status=400)

    valid_statuses = dict(Donation.STATUS_CHOICES)
    if status not in valid_statuses:
        return JsonResponse({"message": f"Status must be one of: {', '.join(valid_statuses)}."}, status=400)

    donation_date_raw = payload.get("donation_date")  # expects "YYYY-MM-DD" from the <input type="date">
    if donation_date_raw:
        donation_date = parse_date(donation_date_raw)
        if not donation_date:
            return JsonResponse({"message": "Donation date must be in YYYY-MM-DD format."}, status=400)
    else:
        donation_date = timezone.now().date()

    disaster_type = None
    disaster_type_id = payload.get("disaster_type_id")
    if disaster_type_id:
        from .models import DisasterType
        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first()
        if not disaster_type:
            return JsonResponse({"message": "Selected disaster type was not found."}, status=400)

    # Goods that are logged here go straight into storage (ReliefStock)
    # under the goods type that was typed, unless the donation is already
    # "distributed" (it has left storage) or has no quantity.
    stock = None
    stored = status != "distributed" and quantity > 0

    with transaction.atomic():
        donation = Donation.objects.create(
            donor_name=donor_name,
            contact_num=(payload.get("contact_num") or "").strip(),
            goods_type=goods_name,
            quantity=quantity,
            donation_date=donation_date,
            status=status,
            disaster_type=disaster_type,
        )

        if stored:
            stock = _stock_for_goods(goods_name)
            stock.quantity += quantity
            stock.save()

    return JsonResponse({
        "success": True,
        "stored_in_inventory": stored,
        "stock": (
            {"goods_type": stock.goods_type, "label": stock.get_goods_type_display(), "quantity": stock.quantity}
            if stock else None
        ),
        "donation": {
            "id": donation.id,
            "donor_name": donation.donor_name,
            "contact_num": donation.contact_num,
            "goods_type": donation.goods_type,
            "quantity": donation.quantity,
            "donation_date": donation.donation_date.strftime("%b %d, %Y"),
            "status": donation.status,
            "disaster_type": disaster_type.disaster_type_name if disaster_type else "",
        },
    })


@csrf_exempt
def cswd_add_relief_stock(request):
    """Lets CSWD staff record relief goods being put into storage —
    e.g. after a donation is sorted, or a fresh batch of sacks/packs
    arrives. Adds to the existing ReliefStock row for that goods_type
    rather than replacing it, so repeated restocks accumulate."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    goods_type = _clean_goods_name(payload.get("goods_type"))
    if not goods_type:
        return JsonResponse({"message": "Goods type must be Rice or Pack."}, status=400)

    try:
        quantity = int(payload.get("quantity"))
        if quantity <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Quantity must be a positive number."}, status=400)

    with transaction.atomic():
        stock = _stock_for_goods(goods_type)
        stock.quantity += quantity
        stock.save()

    return JsonResponse({
        "success": True,
        "stock": {"goods_type": stock.goods_type, "label": stock.get_goods_type_display(), "quantity": stock.quantity},
    })


@csrf_exempt
def cswd_record_relief(request):
    """Logs a relief release to a BARANGAY (its evacuation center) — no
    longer to an individual household — and deducts the released quantity
    from ReliefStock for that goods_type. Fails with a 400 if there isn't
    enough of that goods type left in storage, so stock can never go
    negative. The number of households inside the evacuation center at
    the time is saved on the release (households_served)."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    barangay_obj = Barangay.objects.filter(
        barangay_name__iexact=(payload.get("barangay") or "").strip()
    ).first()
    barangay = barangay_obj.barangay_name if barangay_obj else ""
    goods_type = _clean_goods_name(payload.get("goods_type"))
    remarks = (payload.get("remarks") or "").strip()
    username = (payload.get("username") or "").strip()

    if not barangay_obj or not goods_type:
        return JsonResponse({"message": "Barangay and goods type (Rice or Pack) are required."}, status=400)

    try:
        quantity = int(payload.get("quantity"))
        if quantity <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Quantity must be a positive number."}, status=400)

    # Evacuation center the goods go to: the one picked in the form, or —
    # if the barangay has exactly one — that one automatically.
    center = None
    center_id = payload.get("evacuation_center_id")
    barangay_centers = EvacuationCenter.objects.filter(barangay__iexact=barangay)
    if center_id:
        center = barangay_centers.filter(id=center_id).first()
        if not center:
            return JsonResponse({"message": f"That evacuation center is not in {barangay}."}, status=400)
    elif barangay_centers.count() == 1:
        center = barangay_centers.first()

    # How many households this release covers: those currently inside the
    # evacuation center, or all confirmed households of the barangay when
    # the barangay has no center set up.
    if center:
        households_served = _households_in_center(center)
    else:
        households_served = Household.objects.filter(
            registration_complete=True, status="confirmed", barangay__iexact=barangay
        ).count()

    disaster_type = None
    disaster_type_id = payload.get("disaster_type_id")
    if disaster_type_id:
        from .models import DisasterType
        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first()
        if not disaster_type:
            return JsonResponse({"message": "Selected disaster type was not found."}, status=400)

    try:
        with transaction.atomic():
            stock = _stock_for_goods(goods_type, create=False)
            if not stock or stock.quantity < quantity:
                left = stock.quantity if stock else 0
                return JsonResponse({
                    "message": f"Not enough {goods_type} left in storage (only {left} left).",
                }, status=400)

            stock.quantity -= quantity
            stock.save()

            relief = ReliefDistribution.objects.create(
                household=None,
                barangay=barangay_obj,
                evacuation_center=center,
                households_served=households_served,
                disaster_type=disaster_type,
                goods_type=stock.goods_type,
                quantity_given=quantity,
                distributed_by=username,
                remarks=remarks,
            )
    except Exception as exc:
        return JsonResponse({"message": f"Could not record this relief release: {exc}"}, status=400)

    return JsonResponse({
        "success": True,
        "relief": {
            "barangay": barangay,
            "evacuation_center": center.name if center else "",
            "households_served": households_served,
            "goods_type": relief.get_goods_type_display(),
            "quantity": relief.quantity_given,
            "tracking_number": relief.tracking_number,
            "id": relief.id,
            "claim_status": relief.claim_status,
            "claim_status_label": relief.get_claim_status_display(),
            "distributed_at": _format_ph(relief.distribution_date, "%b %d, %Y"),
        },
        "stock": {"goods_type": stock.goods_type, "label": stock.get_goods_type_display(), "quantity": stock.quantity},
    })


def _barangay_relief_pool(barangay_obj):
    """Relief goods a barangay can still give to households, per goods
    type: everything CSWD released to it that has been marked Received,
    minus what it already handed out to households (cancelled ignored)."""

    pool = {g: 0 for g in GOODS_TYPES}
    received = (
        ReliefDistribution.objects
        .filter(barangay=barangay_obj, household__isnull=True, claim_status="claimed")
        .values("goods_type").annotate(q=Sum("quantity_given"))
    )
    given = (
        ReliefDistribution.objects
        .filter(barangay=barangay_obj, household__isnull=False)
        .exclude(claim_status="cancelled")
        .values("goods_type").annotate(q=Sum("quantity_given"))
    )
    for row in received:
        key = (row["goods_type"] or "").lower()
        if key in pool:
            pool[key] += row["q"] or 0
    for row in given:
        key = (row["goods_type"] or "").lower()
        if key in pool:
            pool[key] -= row["q"] or 0
    return {k: max(v, 0) for k, v in pool.items()}


@csrf_exempt
def barangay_record_relief(request):
    """Barangay Staff give relief goods to a household that is currently
    checked in at one of THEIR barangay's evacuation centers. The goods
    come out of the barangay's own pool (what CSWD released to the
    barangay and was marked Received), not directly out of CSWD storage,
    so it fails with a 400 when the barangay doesn't have enough left."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    username = (payload.get("username") or "").strip()
    valid_barangay = _barangay_for_username(username)
    if not valid_barangay:
        return JsonResponse({
            "message": "Couldn't determine this account's barangay. "
                       "Set its First Name in Django admin > Users to its barangay.",
        }, status=403)
    barangay_obj = Barangay.objects.filter(barangay_name__iexact=valid_barangay).first()

    household_code = (payload.get("household_code") or "").strip()
    goods_type = _clean_goods_name(payload.get("goods_type"))
    remarks = (payload.get("remarks") or "").strip()

    if not household_code or not goods_type:
        return JsonResponse({"message": "Household and goods type (Rice or Pack) are required."}, status=400)

    try:
        quantity = int(payload.get("quantity"))
        if quantity <= 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Quantity must be a positive number."}, status=400)

    household = Household.objects.filter(household_code=household_code).first()
    if not household:
        return JsonResponse({"message": "Selected household was not found."}, status=400)

    # The household must currently be checked in at this barangay's center.
    attendance = (
        Attendance.objects
        .filter(household=household, attendance_status="Present",
                evacuation_center__barangay__iexact=valid_barangay)
        .select_related("evacuation_center")
        .order_by("-check_in_time")
        .first()
    )
    if not attendance:
        return JsonResponse({
            "message": f"{household.full_name}'s household is not checked in at an evacuation center in {valid_barangay}.",
        }, status=400)

    disaster_type = None
    disaster_type_id = payload.get("disaster_type_id")
    if disaster_type_id:
        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first()
        if not disaster_type:
            return JsonResponse({"message": "Selected disaster type was not found."}, status=400)

    with transaction.atomic():
        # Lock this barangay's batches so two staff can't both spend the
        # same remaining goods.
        list(ReliefDistribution.objects.select_for_update().filter(barangay=barangay_obj, household__isnull=True))
        pool = _barangay_relief_pool(barangay_obj)
        left = pool.get(goods_type, 0)
        if left < quantity:
            return JsonResponse({
                "message": f"Not enough {goods_type} left for your barangay (only {left} received and available).",
            }, status=400)

        relief = ReliefDistribution.objects.create(
            household=household,
            barangay=barangay_obj,
            evacuation_center=attendance.evacuation_center,
            households_served=1,
            disaster_type=disaster_type,
            goods_type=goods_type,
            quantity_given=quantity,
            distributed_by=username,
            remarks=remarks,
        )
        pool = _barangay_relief_pool(barangay_obj)

    return JsonResponse({
        "success": True,
        "relief": {
            "id": relief.id,
            "household_code": household.household_code,
            "family_name": household.full_name.split(" ")[-1] if household.full_name else household.household_code,
            "evacuation_center": attendance.evacuation_center.name,
            "goods_type": relief.get_goods_type_display(),
            "quantity": relief.quantity_given,
            "tracking_number": relief.tracking_number,
            "claim_status": relief.claim_status,
            "status": relief.get_claim_status_display(),
            "date": _format_ph(relief.distribution_date, "%b %d, %Y"),
        },
        "relief_pool": pool,
    })


@csrf_exempt
def barangay_update_relief_status(request):
    """Barangay Staff update relief releases of THEIR barangay.
    - A batch CSWD released to the barangay can only be confirmed as
      Received (claimed) — this is the barangay confirming the goods
      arrived. CSWD has no status actions; it just sees the result.
    - A release the barangay gave to a household moves through
      Processing -> Ready for Pickup -> Received.
    Scoped to the staff account's barangay (First Name in Django admin).
    Once Received, a release is locked."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    new_status = (payload.get("status") or "").strip()
    username = (payload.get("username") or "").strip()

    if new_status not in ("processing", "ready", "claimed"):
        return JsonResponse({"message": "Status must be processing, ready or claimed."}, status=400)

    valid_barangay = _barangay_for_username(username)
    if not valid_barangay:
        return JsonResponse({
            "message": "Couldn't determine this account's barangay. "
                       "Set its First Name in Django admin > Users to its barangay.",
        }, status=403)

    try:
        relief_id = int(payload.get("id"))
    except (TypeError, ValueError):
        return JsonResponse({"message": "A valid relief release id is required."}, status=400)

    with transaction.atomic():
        relief = (
            ReliefDistribution.objects.select_for_update()
            .select_related("barangay")
            .filter(id=relief_id, barangay__barangay_name__iexact=valid_barangay)
            .first()
        )
        if not relief:
            return JsonResponse({"message": "Relief release not found for your barangay."}, status=404)

        if relief.claim_status == "claimed":
            return JsonResponse({"message": "This relief was already received, so it can no longer be edited."}, status=400)

        if relief.claim_status == "cancelled":
            return JsonResponse({"message": "This release was cancelled and can't be changed."}, status=400)

        if relief.household_id is None and new_status != "claimed":
            return JsonResponse({
                "message": "Goods released to your barangay can only be confirmed as Received.",
            }, status=400)

        if new_status == relief.claim_status:
            return JsonResponse({"message": "Release is already in that status."}, status=400)

        relief.claim_status = new_status
        relief.status_updated_by = username
        if new_status == "claimed":
            relief.claimed_at = timezone.now()
        relief.save()

    return JsonResponse({
        "success": True,
        "relief": {
            "id": relief.id,
            "claim_status": relief.claim_status,
            "status": relief.get_claim_status_display(),
            "claimed_at": _format_ph(relief.claimed_at, "%b %d, %Y %I:%M %p"),
        },
    })


@csrf_exempt
def drrm_dashboard(request):
    """City-wide DRRM Officer view — every barangay's registration
    pipeline at a glance, plus the fully-confirmed household roster used
    for evacuation/relief planning. DRRM Officers aren't scoped to a
    single barangay the way Purok Presidents / Barangay Staff are."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    all_qs = Household.objects.filter(registration_complete=True)
    confirmed_qs = (
        all_qs.filter(status="confirmed")
        .prefetch_related("family_members")
        .order_by("-created_at")
    )

    barangay_breakdown = [
        {
            "barangay": row["barangay"] or "Unspecified",
            "households": row["total"],
        }
        for row in confirmed_qs.values("barangay").annotate(total=Count("id")).order_by("-total")
    ]

    data = {
        "total_households": confirmed_qs.count(),
        "pending_review": all_qs.filter(status="pending").count(),
        "awaiting_barangay_confirmation": all_qs.filter(status="approved").count(),
        "rejected": all_qs.filter(status="rejected").count(),
        "priority_beneficiaries": _priority_beneficiary_counts(confirmed_qs),
        "barangay_breakdown": barangay_breakdown,
        "households": _serialize_households(confirmed_qs),
    }

    return JsonResponse(data)


def _serialize_route(r):
    return {
        "id": r.id,
        "evacuation_center_id": r.evacuation_center_id,
        "evacuation_center_name": r.evacuation_center.name,
        "barangay": r.evacuation_center.barangay,
        "start_location": r.start_location,
        "route_distance": r.route_distance,
        "estimated_time": r.estimated_time,
        "road_condition": r.road_condition,
        "route_status": r.route_status,
        "pinned_at": _format_ph(r.created_at, "%b %d, %Y %I:%M %p"),
    }


@csrf_exempt
def drrm_routes(request):
    """GET: evacuation centers (for the 'pin a route' form's dropdown)
    plus every existing route, city-wide — DRRM Officers aren't scoped
    to one barangay (see drrm_dashboard above).
    POST: pin a new route to a center."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method == "POST":
        try:
            payload = json.loads(request.body or "{}")
        except json.JSONDecodeError:
            return JsonResponse({"message": "Invalid JSON body."}, status=400)

        center_id = payload.get("evacuation_center_id")
        start_location = (payload.get("start_location") or "").strip()
        route_distance = (payload.get("route_distance") or "").strip()
        estimated_time = (payload.get("estimated_time") or "").strip()
        road_condition = (payload.get("road_condition") or "clear").strip()
        route_status = (payload.get("route_status") or "active").strip()

        if not center_id or not start_location:
            return JsonResponse(
                {"message": "Evacuation center and start location are required."}, status=400
            )

        try:
            center = EvacuationCenter.objects.get(id=center_id)
        except EvacuationCenter.DoesNotExist:
            return JsonResponse({"message": "Evacuation center not found."}, status=404)

        valid_conditions = dict(EvacuationRoute.ROAD_CONDITION_CHOICES)
        if road_condition not in valid_conditions:
            return JsonResponse(
                {"message": f"road_condition must be one of: {', '.join(valid_conditions)}."}, status=400
            )

        valid_statuses = dict(EvacuationRoute.ROUTE_STATUS_CHOICES)
        if route_status not in valid_statuses:
            return JsonResponse(
                {"message": f"route_status must be one of: {', '.join(valid_statuses)}."}, status=400
            )

        route = EvacuationRoute.objects.create(
            evacuation_center=center,
            start_location=start_location,
            route_distance=route_distance,
            estimated_time=estimated_time,
            road_condition=road_condition,
            route_status=route_status,
        )

        return JsonResponse({"success": True, "route": _serialize_route(route)}, status=201)

    if request.method != "GET":
        return JsonResponse({"message": "GET or POST required."}, status=405)

    centers = [
        {"id": c.id, "name": c.name, "barangay": c.barangay}
        for c in EvacuationCenter.objects.all().order_by("barangay", "name")
    ]
    routes = [
        _serialize_route(r)
        for r in EvacuationRoute.objects.select_related("evacuation_center").all()
    ]

    return JsonResponse({"centers": centers, "routes": routes})


def _serialize_disaster_type(dt):
    """One disaster situation. Dates are ISO (YYYY-MM-DD) so the edit form's
    <input type="date"> can use them directly. `donations` / `attendance`
    count the records tied to it (they decide whether it can be deleted)."""
    return {
        "id": dt.id,
        "name": dt.disaster_type_name,
        "status": dt.status,
        "start_date": dt.start_date.isoformat() if dt.start_date else "",
        "end_date": dt.end_date.isoformat() if dt.end_date else "",
        "donations": dt.donations.count(),
        "attendance": dt.attendance_records.count(),
    }


@csrf_exempt
def drrm_disaster_types(request):
    """GET: barangays + disaster types (dropdown data for the DRRM
    Disaster Situation and Routes tabs)."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET required."}, status=405)

    from .models import DisasterType

    return JsonResponse({
        "barangays": list(Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)),
        "disaster_types": [
            _serialize_disaster_type(dt)
            for dt in DisasterType.objects.order_by("-start_date", "disaster_type_name")
        ],
    })


@csrf_exempt
def drrm_add_disaster_type(request):
    """POST: add a new disaster situation (DisasterType row) from the
    'Disaster Situations' sub-panel of the Disaster Location Info tab.
    Matches Process 3.2 (Disaster Situation) in the thesis DFD."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    from .models import DisasterType

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    name = (payload.get("disaster_type_name") or "").strip()
    if not name:
        return JsonResponse({"message": "Disaster name is required."}, status=400)

    status = (payload.get("status") or "active").strip()
    valid_statuses = dict(DisasterType.STATUS_CHOICES)
    if status not in valid_statuses:
        return JsonResponse({"message": f"Status must be one of: {', '.join(valid_statuses)}."}, status=400)

    start_date_raw = payload.get("start_date")
    end_date_raw = payload.get("end_date")
    start_date = parse_date(start_date_raw) if start_date_raw else None
    end_date = parse_date(end_date_raw) if end_date_raw else None

    dt = DisasterType.objects.create(
        disaster_type_name=name,
        start_date=start_date,
        end_date=end_date,
        status=status,
    )
    return JsonResponse({"success": True, "disaster_type": _serialize_disaster_type(dt)}, status=201)


@csrf_exempt
def drrm_update_disaster_type(request):
    """POST {id, disaster_type_name?, start_date?, end_date?, status?}:
    DRRM edits a disaster situation. Send only the fields that changed; an
    empty date string clears that date."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    from .models import DisasterType

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    try:
        dt = DisasterType.objects.get(id=payload.get("id"))
    except (DisasterType.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"success": False, "message": "Disaster situation not found."}, status=404)

    if "disaster_type_name" in payload:
        name = (payload.get("disaster_type_name") or "").strip()
        if not name:
            return JsonResponse({"success": False, "message": "Disaster name is required."}, status=400)
        if len(name) > 100:
            return JsonResponse({"success": False, "message": "Disaster name must be 100 characters or fewer."}, status=400)
        dt.disaster_type_name = name

    if "status" in payload:
        status = (payload.get("status") or "").strip()
        valid = dict(DisasterType.STATUS_CHOICES)
        if status not in valid:
            return JsonResponse(
                {"success": False, "message": f"Status must be one of: {', '.join(valid)}."}, status=400
            )
        dt.status = status

    for field, label in (("start_date", "Start date"), ("end_date", "End date")):
        if field in payload:
            raw = payload.get(field)
            if not raw:
                setattr(dt, field, None)
                continue
            try:
                parsed = parse_date(str(raw))
            except ValueError:
                parsed = None
            if parsed is None:
                return JsonResponse({"success": False, "message": f"{label} must be a valid date (YYYY-MM-DD)."}, status=400)
            setattr(dt, field, parsed)

    if dt.start_date and dt.end_date and dt.end_date < dt.start_date:
        return JsonResponse({"success": False, "message": "End date can't be before the start date."}, status=400)

    dt.save()
    return JsonResponse({"success": True, "disaster_type": _serialize_disaster_type(dt)})


@csrf_exempt
def drrm_delete_disaster_type(request):
    """POST {id}: DRRM removes a disaster situation.

    Donations and evacuee attendance records point at disaster situations
    (and would silently lose their label if it were deleted), so a situation
    that already has records is refused -- set it to 'closed' instead."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    from .models import DisasterType

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    try:
        dt = DisasterType.objects.get(id=payload.get("id"))
    except (DisasterType.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"success": False, "message": "Disaster situation not found."}, status=404)

    donations, attendance = dt.donations.count(), dt.attendance_records.count()
    if donations or attendance:
        parts = []
        if donations:
            parts.append(f"{donations} donation{'s' if donations != 1 else ''}")
        if attendance:
            parts.append(f"{attendance} attendance record{'s' if attendance != 1 else ''}")
        return JsonResponse(
            {
                "success": False,
                "message": (
                    f"\"{dt.disaster_type_name}\" is linked to {' and '.join(parts)} and can't be deleted. "
                    "Set its status to closed instead."
                ),
            },
            status=409,
        )

    try:
        dt.delete()
    except (ProtectedError, RestrictedError):
        return JsonResponse(
            {"success": False, "message": "This disaster situation is still referenced by other records and can't be deleted."},
            status=409,
        )

    return JsonResponse({"success": True})


@csrf_exempt
def drrm_update_route(request):
    """POST {id, route_status?, road_condition?}: DRRM edits a pinned
    route. route_status is also the route's risk level (safe / low /
    medium / high / critical), which drives the shaded risk areas on the
    map. Send either field or both."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    try:
        route = EvacuationRoute.objects.select_related("evacuation_center").get(id=payload.get("id"))
    except (EvacuationRoute.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"success": False, "message": "Route not found."}, status=404)

    if "route_status" not in payload and "road_condition" not in payload:
        return JsonResponse(
            {"success": False, "message": "Provide route_status and/or road_condition."}, status=400
        )

    if "route_status" in payload:
        route_status = (payload.get("route_status") or "").strip()
        valid = dict(EvacuationRoute.ROUTE_STATUS_CHOICES)
        if route_status not in valid:
            return JsonResponse(
                {"success": False, "message": f"route_status must be one of: {', '.join(valid)}."},
                status=400,
            )
        route.route_status = route_status

    if "road_condition" in payload:
        road_condition = (payload.get("road_condition") or "").strip()
        valid = dict(EvacuationRoute.ROAD_CONDITION_CHOICES)
        if road_condition not in valid:
            return JsonResponse(
                {"success": False, "message": f"road_condition must be one of: {', '.join(valid)}."},
                status=400,
            )
        route.road_condition = road_condition

    route.save()
    return JsonResponse({"success": True, "route": _serialize_route(route)})


# ---------------------------------------------------------------------------
# DRRM Evacuation Map — evacuation centers and route risk levels
# ---------------------------------------------------------------------------

RISK_ORDER = {"safe": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}


def _center_eligibility(center):
    """(usable, reason) — a closed or full center is shown on the map but
    is never *recommended* as the destination."""
    if center.status != "open":
        return False, "Center is closed"
    if center.capacity and center.current_occupancy >= center.capacity:
        return False, "Center is full"
    return True, ""


def _highest_risk_by_barangay():
    """{barangay name (lowercase): 'low'|'medium'|'high'|'critical'}, taken
    from pinned routes' route_status. A route counts toward the barangay
    named in its start_location; 'safe' and the non-risk statuses (active,
    under_review, blocked) never register as a risk."""
    names = {n.strip().lower() for n in Barangay.objects.values_list("barangay_name", flat=True)}
    result = {}
    for start, status in EvacuationRoute.objects.values_list("start_location", "route_status"):
        key = (start or "").strip().lower()
        if key not in names:
            continue
        if RISK_ORDER.get(status, 0) > RISK_ORDER.get(result.get(key, ""), 0):
            result[key] = status
    return result


_DISTANCE_RE = re.compile(r"([\d.]+)")


def _parse_route_distance_km(text):
    """route_distance is free text like "2.4 km" (see EvacuationRoute) —
    pulls the leading number out of it, or None if it can't be parsed."""
    if not text:
        return None
    match = _DISTANCE_RE.search(text)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def _build_route_graph(avoid_risk=True):
    """Builds the routing graph from the routes DRRM has pinned
    (EvacuationRoute), with no separate road table: each pinned route IS an
    edge from its start_location (matched to a Barangay by name) to its
    evacuation center.

    Barangays DRRM hasn't pinned a route for yet (and hasn't flagged a risk
    for either, since RiskAreasPanel creates a route the same way) are NOT
    left unroutable: below, any barangay that still has zero edges after
    DRRM's real pinned routes are all added gets a straight-line "passable"
    fallback edge to its nearest evacuation center -- that's the ordinary,
    no-known-problems condition, with no risk penalty, since DRRM hasn't
    flagged anything there. The moment DRRM pins a real route or sets a
    risk level for that barangay, that real edge takes over and this
    fallback is skipped for it.

    Edge weight uses route_distance when it's set; otherwise falls back to
    the straight-line distance between the barangay and the center's
    coordinates. road_condition and route_status (used as risk) work the
    same way as everywhere else in the app: an impassable route is dropped
    entirely, and avoid_risk penalises medium/high/critical routes.

    Returns (graph, node_info, center_objs) where node_info maps
    node -> {"name", "lat", "lng", "type"}.
    """
    barangays = {b.barangay_name.strip().lower(): b for b in Barangay.objects.all()}

    graph = routing.Graph()
    node_info = {}
    center_objs = {}

    # Every evacuation center is a graph node from the start (not just ones
    # DRRM has already pinned a route to), so the fallback pass below always
    # has somewhere to connect an unrouted barangay to.
    for center in EvacuationCenter.objects.all():
        c_node = f"c{center.id}"
        home = barangays.get((center.barangay or "").strip().lower())
        lat = center.latitude if center.latitude is not None else (home.latitude if home else None)
        lng = center.longitude if center.longitude is not None else (home.longitude if home else None)
        node_info[c_node] = {"name": center.name, "lat": lat, "lng": lng, "type": "center"}
        center_objs[c_node] = center
        graph.add_node(c_node)

    for route in EvacuationRoute.objects.select_related("evacuation_center"):
        center = route.evacuation_center
        barangay = barangays.get((route.start_location or "").strip().lower())
        if barangay is None:
            continue  # start_location doesn't match a known barangay -- can't place it on the graph

        b_node, c_node = f"b{barangay.id}", f"c{center.id}"
        if b_node not in node_info:
            node_info[b_node] = {"name": barangay.barangay_name, "lat": barangay.latitude, "lng": barangay.longitude, "type": "barangay"}

        km = _parse_route_distance_km(route.route_distance)
        if km is None:
            a, b = node_info[b_node], node_info[c_node]
            if None in (a["lat"], a["lng"], b["lat"], b["lng"]):
                continue  # no distance on the route and no coordinates to estimate one
            km = routing.haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])

        risk = {c_node: routing.RISK_MULTIPLIER[route.route_status]} if avoid_risk and route.route_status in routing.RISK_MULTIPLIER else None
        graph.add_edge(b_node, c_node, km, route.road_condition, segment_id=route.id, risk=risk)

    # Fallback connectivity for barangays DRRM hasn't touched at all: a
    # straight-line "passable" edge (no risk penalty) to the nearest
    # evacuation center, so the resident app doesn't dead-end on "no route
    # pinned yet" just because DRRM hasn't gotten to that barangay.
    centers_with_coords = [
        (c_node, node_info[c_node]["lat"], node_info[c_node]["lng"])
        for c_node in center_objs
        if node_info[c_node]["lat"] is not None and node_info[c_node]["lng"] is not None
    ]
    if centers_with_coords:
        for barangay in barangays.values():
            if barangay.latitude is None or barangay.longitude is None:
                continue
            b_node = f"b{barangay.id}"
            if graph.adj.get(b_node):
                continue  # already has at least one real pinned route -- DRRM's data wins

            node_info.setdefault(
                b_node,
                {"name": barangay.barangay_name, "lat": barangay.latitude, "lng": barangay.longitude, "type": "barangay"},
            )
            nearest_c_node, c_lat, c_lng = min(
                centers_with_coords,
                key=lambda c: routing.haversine_km(barangay.latitude, barangay.longitude, c[1], c[2]),
            )
            km = routing.road_length_km(barangay.latitude, barangay.longitude, c_lat, c_lng)
            graph.add_edge(b_node, nearest_c_node, km, "passable", segment_id=None)

    return graph, node_info, center_objs



def _route_result_json(result, node_info, center_objs):
    """Turns a routing.find_evacuation_routes() entry into API JSON."""
    center = center_objs[result["center"]]
    usable, reason = _center_eligibility(center)
    nodes, edges = result["nodes"], result["edges"]
    return {
        "center": {
            "id": center.id,
            "name": center.name,
            "barangay": center.barangay,
            "latitude": node_info[result["center"]]["lat"],
            "longitude": node_info[result["center"]]["lng"],
            "occupancy": center.current_occupancy,
            "capacity": center.capacity,
            "status": center.status,
        },
        "eligible": usable,
        "ineligible_reason": reason,
        "distance_km": result["distance_km"],
        "est_minutes": result["minutes"],
        "cost": result["cost"],
        "geometry": [
            [node_info[n]["lat"], node_info[n]["lng"]] for n in nodes
            if node_info[n]["lat"] is not None and node_info[n]["lng"] is not None
        ],
        "legs": [
            {
                "from": node_info[nodes[i]]["name"],
                "to": node_info[nodes[i + 1]]["name"],
                "distance_km": round(e["distance_km"], 2),
                "road_condition": e["condition"],
                "route_id": e["segment_id"],
            }
            for i, e in enumerate(edges)
        ],
    }


def _nearest_route_from_point(lat, lng, avoid_risk=True, center_id=None):
    """Shortest path (Dijkstra) from an arbitrary lat/lng — a resident's GPS
    fix, or their household's saved location — to the nearest evacuation
    center. Reuses the exact same graph DRRM's drrm_fastest_route builds
    from pinned routes (_build_route_graph) — no separate road/segment
    table, same as everywhere else in this app.

    The point is attached to the graph with a temporary "virtual start"
    node connected by straight-line connectors to EVERY barangay that has
    a route (routing.attach_virtual_start with k = all of them, not just
    the 2 geographically nearest) -- the graph only has barangay-to-center
    edges, not barangay-to-barangay ones, so connecting to just the
    nearest couple of barangays could miss the barangay that actually
    leads to the cheapest overall path and silently return a "shortest"
    route that wasn't. Connecting to all of them costs nothing on a
    graph this size and guarantees Dijkstra sees the true minimum.

    Returns (recommended, alternatives, message) — recommended/alternatives
    are _route_result_json() dicts (or None/[] if nothing is reachable).
    """
    graph, node_info, center_objs = _build_route_graph(avoid_risk=avoid_risk)
    if not center_objs:
        return None, [], "No evacuation centers have been registered yet."

    barangay_nodes = [
        n for n, info in node_info.items()
        if info["type"] == "barangay" and info["lat"] is not None and info["lng"] is not None
    ]
    if not barangay_nodes:
        return None, [], "No barangays have coordinates set yet, so a route can't be drawn."

    node_coords = {n: (node_info[n]["lat"], node_info[n]["lng"]) for n in barangay_nodes}
    source = "resident_start"
    routing.attach_virtual_start(graph, source, lat, lng, node_coords, barangay_nodes, k=len(barangay_nodes))
    node_info[source] = {"name": "Your location", "lat": lat, "lng": lng, "type": "start"}

    targets = list(center_objs.keys())
    if center_id:
        targets = [n for n in targets if str(center_objs[n].id) == str(center_id)]
        if not targets:
            return None, [], "That evacuation center can't be routed to."

    results = routing.find_evacuation_routes(graph, source, targets)
    if not results:
        return None, [], "No evacuation center is reachable from your location yet — it may be marked impassable."

    routes = [_route_result_json(r, node_info, center_objs) for r in results]
    recommended = next((r for r in routes if r["eligible"]), None)
    alternatives = [r for r in routes if r is not recommended][:4]
    message = "" if recommended else "Centers are reachable, but none are currently open with space available."
    return recommended, alternatives, message


def _household_location(household):
    """Best known point for a household: their saved GPS fix if they gave
    one at registration, else their barangay's centroid. Returns
    (lat, lng, source) or (None, None, None) if neither is available."""
    if household.gps_lat is not None and household.gps_lng is not None:
        return household.gps_lat, household.gps_lng, "household_gps"

    name = (household.barangay or "").strip().lower()
    if name:
        barangay = Barangay.objects.filter(barangay_name__iexact=name).first()
        if barangay and barangay.latitude is not None and barangay.longitude is not None:
            return barangay.latitude, barangay.longitude, "barangay_centroid"

    return None, None, None


@csrf_exempt
def resident_nearest_route(request):
    """GET: for the resident app's evacuation map — the shortest (Dijkstra)
    route from the resident's current position to the nearest open
    evacuation center with space, reusing the same pinned-route graph as
    the DRRM dashboard's drrm_fastest_route. No separate road table.

    Query params:
      mobile_number  required -- identifies the resident (used to fall
                     back to their saved household location, and so a
                     future version can log/personalize this per-account)
      lat, lng       optional -- resident's live GPS fix (e.g. from the
                     map screen's "show my location"). When omitted, falls
                     back to the household's saved gps_lat/gps_lng, then
                     to their barangay's centroid.
      center_id      optional -- force this evacuation center instead of
                     automatically picking the nearest eligible one
      avoid_risk     "1" (default) penalises routes flagged medium/high/
                     critical risk; "0" ignores it
    """
    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET required."}, status=405)

    mobile_number = (request.GET.get("mobile_number") or "").strip()
    if not mobile_number:
        return JsonResponse({"message": "Provide mobile_number."}, status=400)

    try:
        household = Household.objects.get(mobile_number=mobile_number)
    except Household.DoesNotExist:
        return JsonResponse({"message": "Household not found."}, status=404)

    lat_param, lng_param = request.GET.get("lat"), request.GET.get("lng")
    location_source = "live_gps"
    if lat_param is not None and lng_param is not None:
        try:
            lat, lng = float(lat_param), float(lng_param)
        except ValueError:
            return JsonResponse({"message": "lat/lng must be numbers."}, status=400)
    else:
        lat, lng, location_source = _household_location(household)
        if lat is None:
            return JsonResponse({
                "message": "We don't know your location yet. Enable location on the map, "
                           "or add your address during registration.",
            }, status=404)

    avoid_risk = (request.GET.get("avoid_risk", "1") or "1").strip() not in ("0", "false", "no")
    center_id = request.GET.get("center_id")

    recommended, alternatives, message = _nearest_route_from_point(
        lat, lng, avoid_risk=avoid_risk, center_id=center_id
    )

    return JsonResponse({
        "algorithm": "dijkstra",
        "avoid_risk": avoid_risk,
        "start": {"latitude": lat, "longitude": lng, "source": location_source},
        "recommended": recommended,
        "alternatives": alternatives,
        "message": message,
    }, status=200 if recommended else 404)


@csrf_exempt
def drrm_fastest_route(request):
    """GET: fastest evacuation route from a barangay, computed with
    Dijkstra's algorithm (see routing.py) over the routes DRRM has already
    pinned (EvacuationRoute) -- no separate road table, so a route can only
    be found where DRRM has pinned one from that barangay.

    Query params:
      from_barangay   required -- name of the starting barangay
      avoid_risk      "1" (default) penalises routes flagged medium/high/
                       critical (EvacuationRoute.route_status); "0" ignores it
      center_id       optional -- force this evacuation center instead of
                       automatically picking the fastest open one
    """

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET required."}, status=405)

    from_name = (request.GET.get("from_barangay") or "").strip()
    if not from_name:
        return JsonResponse({"message": "Provide from_barangay."}, status=400)

    avoid_risk = (request.GET.get("avoid_risk", "1") or "1").strip() not in ("0", "false", "no")
    graph, node_info, center_objs = _build_route_graph(avoid_risk=avoid_risk)

    if not center_objs:
        return JsonResponse({
            "message": "No evacuation centers have been registered yet.",
        }, status=404)

    source = next(
        (n for n, i in node_info.items() if i["type"] == "barangay" and i["name"].lower() == from_name.lower()),
        None,
    )
    if source is None:
        return JsonResponse({
            "message": f"No pinned route starts from '{from_name}' yet.",
        }, status=404)
    start = {"name": node_info[source]["name"], "latitude": node_info[source]["lat"], "longitude": node_info[source]["lng"]}

    targets = list(center_objs.keys())
    forced = request.GET.get("center_id")
    if forced:
        targets = [n for n in targets if str(center_objs[n].id) == str(forced)]
        if not targets:
            return JsonResponse({"message": "That evacuation center can't be routed to."}, status=404)

    results = routing.find_evacuation_routes(graph, source, targets)
    if not results:
        return JsonResponse({
            "message": f"No route from '{from_name}' reaches an evacuation center -- it may be marked impassable.",
        }, status=404)

    routes = [_route_result_json(r, node_info, center_objs) for r in results]
    recommended = next((r for r in routes if r["eligible"]), None)
    alternatives = [r for r in routes if r is not recommended][:4]

    return JsonResponse({
        "algorithm": "dijkstra",
        "avoid_risk": avoid_risk,
        "start": start,
        "recommended": recommended,
        "alternatives": alternatives,
        "message": "" if recommended else "Centers are reachable, but none are currently open with space available.",
    })


@csrf_exempt
def drrm_delete_evacuation_center(request):
    """POST {id}: DRRM removes an evacuation center from the map.

    Saved routes pointing at the center are deleted with it (a route to a
    center that no longer exists is meaningless). If evacuees have already
    been checked in there, the delete is refused so attendance history isn't
    wiped -- set the center to 'closed' instead."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    try:
        center = EvacuationCenter.objects.get(id=payload.get("id"))
    except (EvacuationCenter.DoesNotExist, ValueError, TypeError):
        return JsonResponse({"success": False, "message": "Evacuation center not found."}, status=404)

    if Attendance.objects.filter(evacuation_center=center).exists():
        return JsonResponse(
            {
                "success": False,
                "message": (
                    f"\"{center.name}\" has evacuee attendance records and can't be deleted. "
                    "Set its status to closed instead."
                ),
            },
            status=409,
        )

    try:
        with transaction.atomic():
            EvacuationRoute.objects.filter(evacuation_center=center).delete()
            center.delete()
    except (ProtectedError, RestrictedError):
        return JsonResponse(
            {"success": False, "message": "This center is still referenced by other records and can't be deleted."},
            status=409,
        )

    return JsonResponse({"success": True})


@csrf_exempt
def drrm_map(request):
    """GET: everything the DRRM evacuation map draws — barangays, evacuation
    centers and route risk levels — plus a list of what's still missing
    coordinates so the UI can tell the officer what to fill in."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET required."}, status=405)

    risk_levels = _highest_risk_by_barangay()
    household_counts = {
        (row["barangay"] or "").strip().lower(): row["total"]
        for row in Household.objects.filter(registration_complete=True, status="confirmed")
        .values("barangay").annotate(total=Count("id"))
    }

    all_barangays = list(Barangay.objects.order_by("barangay_name"))
    located = [b for b in all_barangays if None not in (b.latitude, b.longitude)]
    by_name = {b.barangay_name.strip().lower(): b for b in located}

    barangays = [
        {
            "id": b.id,
            "name": b.barangay_name,
            "latitude": b.latitude,
            "longitude": b.longitude,
            "risk_level": risk_levels.get(b.barangay_name.strip().lower(), ""),
            "households": household_counts.get(b.barangay_name.strip().lower(), 0),
        }
        for b in located
    ]

    centers, centers_missing = [], []
    for c in EvacuationCenter.objects.order_by("barangay", "name"):
        home = by_name.get((c.barangay or "").strip().lower())
        exact = None not in (c.latitude, c.longitude)
        if not exact and not home:
            centers_missing.append(c.name)
            continue
        usable, reason = _center_eligibility(c)
        centers.append({
            "id": c.id,
            "name": c.name,
            "barangay": c.barangay,
            "latitude": c.latitude if exact else home.latitude,
            "longitude": c.longitude if exact else home.longitude,
            "approximate": not exact,
            "capacity": c.capacity,
            "occupancy": c.current_occupancy,
            "status": c.status,
            "eligible": usable,
            "ineligible_reason": reason,
        })

    # Risk areas come from pinned routes: a route whose route_status is a
    # risk level (safe .. critical) is drawn at the barangay it starts from.
    risk_areas = []
    for r in EvacuationRoute.objects.select_related("evacuation_center"):
        if r.route_status not in RISK_ORDER:
            continue
        home = by_name.get((r.start_location or "").strip().lower())
        if not home:
            continue
        risk_areas.append({
            "id": r.id,
            "barangay": home.barangay_name,
            "latitude": home.latitude,
            "longitude": home.longitude,
            "risk_level": r.route_status,
            "road_condition": r.road_condition,
            "disaster_type": "",
            "description": f"Route to {r.evacuation_center.name}",
        })

    return JsonResponse({
        "barangays": barangays,
        "centers": centers,
        "risk_areas": risk_areas,
        "missing_coordinates": {
            "barangays": [b.barangay_name for b in all_barangays if None in (b.latitude, b.longitude)],
            "centers": centers_missing,
        },
        "total_barangays": len(all_barangays),
    })


def _haversine_km(lat1, lng1, lat2, lng2):
    from math import radians, sin, cos, asin, sqrt
    p1, p2 = radians(lat1), radians(lat2)
    a = sin((p2 - p1) / 2) ** 2 + cos(p1) * cos(p2) * sin(radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371.0088 * asin(sqrt(a))


@csrf_exempt
def drrm_set_risk_area(request):
    """POST {barangay, risk_level, road_condition?}: DRRM flags a barangay
    as a risk area from the evacuation map.

    risk_level is one of safe / low / medium / high / critical, or "none" to
    clear the flag. The change is applied to the pinned routes that start in
    that barangay, so the risk level (route_status) AND the road condition
    update together and the map redraws the shaded circle:

      * routes already start there  -> all of them are updated;
      * none do yet                 -> one route is created from the barangay
        to the nearest evacuation center, since the risk level lives on a
        route (see EvacuationRoute.route_status).

    "none" puts those routes back to route_status "active" and road_condition
    "clear", which removes the circle.
    """

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"success": False, "message": "Invalid JSON body."}, status=400)

    barangay_name = (payload.get("barangay") or "").strip()
    risk_level = (payload.get("risk_level") or "").strip()
    road_condition = (payload.get("road_condition") or "").strip()

    if not barangay_name:
        return JsonResponse({"success": False, "message": "Barangay is required."}, status=400)

    barangay = next(
        (b for b in Barangay.objects.all() if b.barangay_name.strip().lower() == barangay_name.lower()),
        None,
    )
    if barangay is None:
        return JsonResponse({"success": False, "message": f"'{barangay_name}' isn't in the Barangay table."}, status=404)

    clearing = risk_level == "none"
    if not clearing and risk_level not in RISK_ORDER:
        return JsonResponse(
            {"success": False, "message": f"risk_level must be one of: {', '.join(RISK_ORDER)}, none."},
            status=400,
        )

    valid_conditions = dict(EvacuationRoute.ROAD_CONDITION_CHOICES)
    if clearing:
        road_condition = "clear"
    else:
        road_condition = road_condition or "clear"
        if road_condition not in valid_conditions:
            return JsonResponse(
                {"success": False, "message": f"road_condition must be one of: {', '.join(valid_conditions)}."},
                status=400,
            )

    key = barangay.barangay_name.strip().lower()
    routes = [
        r for r in EvacuationRoute.objects.select_related("evacuation_center")
        if (r.start_location or "").strip().lower() == key
    ]

    with transaction.atomic():
        if clearing:
            for r in routes:
                if r.route_status in RISK_ORDER:  # leave active / under_review / blocked alone
                    r.route_status = "active"
                r.road_condition = "clear"
                r.save(update_fields=["route_status", "road_condition"])
            return JsonResponse({
                "success": True,
                "barangay": barangay.barangay_name,
                "risk_level": "none",
                "road_condition": "clear",
                "routes_updated": len(routes),
                "route_created": False,
            })

        if routes:
            for r in routes:
                r.route_status = risk_level
                r.road_condition = road_condition
                r.save(update_fields=["route_status", "road_condition"])
            return JsonResponse({
                "success": True,
                "barangay": barangay.barangay_name,
                "risk_level": risk_level,
                "road_condition": road_condition,
                "routes_updated": len(routes),
                "route_created": False,
            })

        # No route starts here yet: create one to the nearest evacuation center.
        centers = list(EvacuationCenter.objects.all())
        if not centers:
            return JsonResponse(
                {"success": False, "message": "Register an evacuation center first — a risk area is stored on a route to a center."},
                status=400,
            )

        def center_point(c):
            if None not in (c.latitude, c.longitude):
                return c.latitude, c.longitude
            if (c.barangay or "").strip().lower() == key and None not in (barangay.latitude, barangay.longitude):
                return barangay.latitude, barangay.longitude
            return None

        def distance_to(c):
            pt = center_point(c)
            if pt is None or None in (barangay.latitude, barangay.longitude):
                return float("inf")
            return _haversine_km(barangay.latitude, barangay.longitude, pt[0], pt[1])

        # Prefer a center in the same barangay, then the nearest open one, then the nearest.
        same = [c for c in centers if (c.barangay or "").strip().lower() == key]
        pool = same or [c for c in centers if c.status == "open"] or centers
        target = min(pool, key=distance_to)

        route_kwargs = {}
        km = distance_to(target)
        if km != float("inf"):
            road_km = km * 1.3  # straight line -> rough road length
            route_kwargs["route_distance"] = f"{road_km:.1f} km"
            route_kwargs["estimated_time"] = f"{max(1, round(road_km / 25 * 60))} mins"

        EvacuationRoute.objects.create(
            evacuation_center=target,
            start_location=barangay.barangay_name,
            road_condition=road_condition,
            route_status=risk_level,
            **route_kwargs,
        )

    return JsonResponse({
        "success": True,
        "barangay": barangay.barangay_name,
        "risk_level": risk_level,
        "road_condition": road_condition,
        "routes_updated": 0,
        "route_created": True,
        "center": target.name,
    }, status=201)


def _serialize_new_center(c):
    """Matches the shape drrm_map() already returns per-center, so the
    frontend's optimistic UI (and any code that reuses that shape) works
    the same right after creation as it does after a page reload."""
    usable, reason = _center_eligibility(c)
    return {
        "id": c.id,
        "name": c.name,
        "barangay": c.barangay,
        "latitude": c.latitude,
        "longitude": c.longitude,
        "approximate": False,
        "capacity": c.capacity,
        "occupancy": c.current_occupancy,
        "status": c.status,
        "eligible": usable,
        "ineligible_reason": reason,
    }


@csrf_exempt
def drrm_add_evacuation_center(request):
    """POST {name, barangay, latitude, longitude, capacity?, status?}:
    DRRM pins a new evacuation center on the map. Matches the
    EvacuationCenter model exactly — capacity defaults to 0 and status
    defaults to 'open' if omitted, current_occupancy always starts at 0
    for a brand-new center."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    name = (payload.get("name") or payload.get("center_name") or "").strip()
    barangay = _match_barangay(payload.get("barangay"))
    latitude = payload.get("latitude")
    longitude = payload.get("longitude")
    capacity = payload.get("capacity")
    status = (payload.get("status") or "open").strip()

    if not name:
        return JsonResponse({"message": "Center name is required."}, status=400)
    if not barangay:
        return JsonResponse({"message": "A valid barangay is required."}, status=400)

    try:
        latitude = float(latitude)
        longitude = float(longitude)
    except (TypeError, ValueError):
        return JsonResponse({"message": "Click a location on the map to set the pin."}, status=400)

    valid_statuses = dict(EvacuationCenter.STATUS_CHOICES)
    if status not in valid_statuses:
        return JsonResponse({"message": f"status must be one of: {', '.join(valid_statuses)}."}, status=400)

    try:
        capacity = int(capacity) if capacity not in (None, "") else 0
        if capacity < 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Capacity must be a non-negative whole number."}, status=400)

    center = EvacuationCenter.objects.create(
        name=name,
        barangay=barangay,
        latitude=latitude,
        longitude=longitude,
        capacity=capacity,
        status=status,
    )

    return JsonResponse({"success": True, "center": _serialize_new_center(center)}, status=201)


@csrf_exempt
def barangay_dashboard(request):
    """Real household registrations for Barangay Staff — specifically
    the ones a Purok President has already approved and forwarded, which
    Barangay Staff give final confirmation on before they become visible
    city-wide to CSWD/DRRM. Scoped to the staff account's barangay the
    same way purok_dashboard is (via First Name in Django admin)."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    username_param = (request.GET.get("username") or "").strip()
    barangay_override = (request.GET.get("barangay") or "").strip()

    valid_barangay = _barangay_for_username(username_param) or _match_barangay(barangay_override)

    if not valid_barangay:
        return JsonResponse({
            "barangay": "",
            "total_households": 0,
            "pending_confirmation": 0,
            "rejected_households": 0,
            "unregistered_households": 0,
            "households": [],
            "message": (
                "Couldn't determine this account's barangay. "
                "Set its First Name in Django admin > Users to its barangay (e.g. 'Tubod')."
            ),
        })

    households_qs = (
        Household.objects
        .filter(registration_complete=True, barangay__iexact=valid_barangay)
        .exclude(status="pending")  # Purok President hasn't reviewed these yet
        .prefetch_related("family_members")
        .order_by("-created_at")
    )

    # Evacuation center(s) of this barangay with the households currently
    # checked in, and the relief CSWD has released to this barangay.
    centers = list(EvacuationCenter.objects.filter(barangay__iexact=valid_barangay).order_by("id"))
    present_by_center = _center_household_stats([c.id for c in centers])
    centers_payload = []
    for c in centers:
        present = present_by_center.get(c.id, [])
        centers_payload.append({
            "id": c.id,
            "name": c.name,
            "occupancy": f"{c.current_occupancy} / {c.capacity}",
            "status": c.status,
            "households_in_center": len(present),
            "members_in_center": sum(h["members_present"] for h in present),
            "households": present,  # already ordered most-vulnerable first
        })

    # Relief the barangay gave to individual households — shown next to
    # each checked-in household and in the "Relief Given to Households" table.
    hh_relief_qs = list(
        ReliefDistribution.objects
        .filter(household__isnull=False, barangay__barangay_name__iexact=valid_barangay)
        .exclude(claim_status="cancelled")
        .select_related("household", "evacuation_center")
        .order_by("-distribution_date", "-id")[:100]
    )
    household_relief = [
        {
            "id": r.id,
            "tracking_number": r.tracking_number,
            "household_code": r.household.household_code,
            "family_name": r.household.full_name.split(" ")[-1] if r.household.full_name else r.household.household_code,
            "evacuation_center": r.evacuation_center.name if r.evacuation_center else "",
            "goods_type": r.get_goods_type_display(),
            "quantity": r.quantity_given,
            "claim_status": r.claim_status,
            "status": r.get_claim_status_display(),
            "date": _format_ph(r.distribution_date, "%b %d, %Y"),
            "claimed_at": _format_ph(r.claimed_at, "%b %d, %Y %I:%M %p"),
        }
        for r in hh_relief_qs
    ]
    relief_by_household = {}
    for r in hh_relief_qs:
        relief_by_household.setdefault(r.household.household_code, []).append(r)
    for c in centers_payload:
        for h in c["households"]:
            recs = relief_by_household.get(h["household_code"], [])
            if any(r.claim_status == "ready" for r in recs):
                h["relief_status"] = "Ready for Pickup"
            elif any(r.claim_status in ("processing", "pending") for r in recs):
                h["relief_status"] = "Processing"
            elif recs:
                h["relief_status"] = "Relief Given"
            else:
                h["relief_status"] = "Not Yet Given"
            last = recs[0] if recs else None
            h["relief_last"] = (
                f"{last.quantity_given}x {last.get_goods_type_display()} · {_format_ph(last.distribution_date, '%b %d, %Y')}"
                if last else ""
            )

    barangay_row = Barangay.objects.filter(barangay_name__iexact=valid_barangay).first()

    relief_releases = [
        {
            "id": r.id,
            "tracking_number": r.tracking_number,
            "evacuation_center": r.evacuation_center.name if r.evacuation_center else "",
            "households_served": r.households_served,
            "goods_type": r.get_goods_type_display(),
            "quantity": r.quantity_given,
            "claim_status": r.claim_status,
            "status": r.get_claim_status_display(),
            "remarks": r.remarks,
            "date": _format_ph(r.distribution_date, "%b %d, %Y"),
            "claimed_at": _format_ph(r.claimed_at, "%b %d, %Y %I:%M %p"),
        }
        for r in (
            ReliefDistribution.objects
            .filter(household__isnull=True, barangay__barangay_name__iexact=valid_barangay)
            .exclude(claim_status="cancelled")
            .select_related("evacuation_center")
            .order_by("-distribution_date", "-id")[:50]
        )
    ]

    # Vulnerability profiles (ERD: vulnerability_profiling) for this
    # barangay's confirmed households — recomputed from the latest member
    # flags, then read back ranked by priority.
    confirmed_qs = households_qs.filter(status="confirmed")
    for hh in confirmed_qs:
        sync_vulnerability_profile(hh)

    profile_rows = (
        VulnerabilityProfile.objects
        .filter(household__in=confirmed_qs)
        .select_related("household", "family_member", "disaster_type")
        .order_by("-priority_score", "household__full_name", "id")
    )
    vulnerability_profiles = []
    seen_households = set()
    for vp in profile_rows:
        if vp.household_id in seen_households:
            continue  # several active disasters share the same score; list each household once
        seen_households.add(vp.household_id)
        hh = vp.household
        vulnerability_profiles.append({
            "id": vp.id,
            "household_code": hh.household_code,
            "family_name": hh.full_name.split(" ")[-1] if hh.full_name else hh.household_code,
            "purok": hh.purok or "—",
            "flags": vp.flag_list,
            "priority_score": vp.priority_score,
            "priority_level": vp.priority_level,
            "key_member": vp.family_member.full_name if vp.family_member else "",
            "disaster": vp.disaster_type.disaster_type_name if vp.disaster_type else "",
            "members": hh.family_members.count(),
            "updated": _format_ph(vp.updated_at, "%b %d, %Y %I:%M %p"),
        })

    beneficiary = _priority_beneficiary_counts(confirmed_qs)
    vulnerability_summary = {
        "households": len(vulnerability_profiles),
        "senior_citizens": beneficiary["senior_citizens"],
        "pwd": beneficiary["pwd"],
        "pregnant": beneficiary["pregnant"],
        "children": beneficiary["children"],
        "high": sum(1 for v in vulnerability_profiles if v["priority_level"] == "High"),
        "medium": sum(1 for v in vulnerability_profiles if v["priority_level"] == "Medium"),
        "low": sum(1 for v in vulnerability_profiles if v["priority_level"] == "Low"),
    }

    data = {
        "barangay": valid_barangay,
        "vulnerability_summary": vulnerability_summary,
        "vulnerability_profiles": vulnerability_profiles,
        "evacuation_centers": centers_payload,
        "households_in_evacuation": sum(c["households_in_center"] for c in centers_payload),
        "relief_releases": relief_releases,
        "household_relief": household_relief,
        "relief_pool": _barangay_relief_pool(barangay_row) if barangay_row else {g: 0 for g in GOODS_TYPES},
        "disaster_types": [
            {"id": dt.id, "name": dt.disaster_type_name, "status": dt.status}
            for dt in DisasterType.objects.filter(status="active").order_by("-start_date", "disaster_type_name")
        ],
        "relief_released": sum(
            r["quantity"] for r in relief_releases
        ),
        "total_households": households_qs.filter(status="confirmed").count(),
        "pending_confirmation": households_qs.filter(status="approved").count(),
        "rejected_households": households_qs.filter(status="rejected").count(),
        "unregistered_households": Household.objects.filter(
            registration_complete=False,
            barangay__iexact=valid_barangay,
        ).count(),
        "households": _serialize_households(households_qs),
    }

    return JsonResponse(data)


@csrf_exempt
def barangay_confirm_household(request, household_code):
    """Persists a Barangay Staff member's confirm/reject decision on a
    household that a Purok President already approved. This is the last
    step before a household becomes visible to CSWD and DRRM."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)
        action = (data.get("action") or "").strip().lower()
        reviewer_username = (data.get("username") or "").strip()

        if action not in ("confirm", "reject"):
            return JsonResponse({
                "success": False,
                "message": "action must be 'confirm' or 'reject'."
            }, status=400)

        try:
            household = Household.objects.get(household_code=household_code)
        except Household.DoesNotExist:
            return JsonResponse({
                "success": False,
                "message": "Household not found."
            }, status=404)

        reviewer_barangay = _barangay_for_username(reviewer_username)
        if not reviewer_barangay:
            return JsonResponse({
                "success": False,
                "message": "Couldn't determine your assigned barangay. Please log in again."
            }, status=403)

        if household.barangay.lower() != reviewer_barangay.lower():
            return JsonResponse({
                "success": False,
                "message": "This household is registered under a different barangay."
            }, status=403)

        if household.status != "approved":
            return JsonResponse({
                "success": False,
                "message": "This household hasn't been approved by a Purok President yet."
            }, status=400)

        household.status = "confirmed" if action == "confirm" else "rejected"
        household.save()

        if household.status == "confirmed":
            sync_vulnerability_profile(household)

        return JsonResponse({
            "success": True,
            "household_code": household.household_code,
            "status": household.status,
        })

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)


@csrf_exempt
def barangay_evacuation_dashboard(request):
    """Evacuation center info + today's check-ins for the GeoAid Staff
    mobile app's dashboard. Scoped to the staff account's barangay the
    same way barangay_dashboard is (via First Name in Django admin).
    Assumes one EvacuationCenter per barangay for now — if a barangay
    ever has more than one, this returns the first (lowest id)."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    from django.utils import timezone
    from .models import EvacuationCenter, Attendance, DisasterType

    username_param = (request.GET.get("username") or "").strip()
    valid_barangay = _barangay_for_username(username_param)

    if not valid_barangay:
        return JsonResponse({
            "message": "Couldn't determine this account's barangay. "
                       "Set its First Name in Django admin > Users to its barangay.",
        }, status=403)

    center = (
        EvacuationCenter.objects
        .filter(barangay__iexact=valid_barangay)
        .order_by("id")
        .first()
    )
    if not center:
        return JsonResponse({
            "message": f"No evacuation center is set up yet for {valid_barangay}.",
        }, status=404)

    # All centers for this barangay — the Evacuation Centers tab lists
    # every one of them (previously only "center" below was returned,
    # so a barangay with more than one center only ever showed the
    # oldest). Attendance/check-in scanning below still targets a single
    # center ("center", the oldest by id) — that flow is unchanged.
    all_centers_qs = EvacuationCenter.objects.filter(barangay__iexact=valid_barangay).order_by("id")
    present_by_center = _center_household_stats([c.id for c in all_centers_qs])
    evacuation_centers = [
        {
            "id": c.id,
            "name": c.name,
            "barangay": c.barangay,
            "occupancy": c.current_occupancy,
            "capacity": c.capacity,
            "status": c.status,
            "households_in_center": len(present_by_center.get(c.id, [])),
        }
        for c in all_centers_qs
    ]

    # PH date, not UTC/server date — otherwise "today" flips over at UTC
    # midnight (8am Philippine time), showing yesterday's check-ins as
    # today's for part of the morning.
    today = _to_ph(timezone.now()).date()
    # Only counts residents still checked in (not "everyone who ever
    # checked in today") — so this number goes back down when someone
    # checks out, matching how the occupancy bar already behaves.
    today_checkins = Attendance.objects.filter(
        evacuation_center=center,
        check_in_time__date=today,
        attendance_status="Present",
    ).count()

    recent = (
        Attendance.objects.filter(evacuation_center=center)
        .select_related("family_member", "household")
        .order_by("-check_in_time")[:25]
    )
    recent_checkins = [
        {
            "name": a.family_member.full_name,
            "household": f"{a.household.full_name} Household",
            "time": _format_ph(a.check_in_time, "%b %d, %Y %I:%M %p") if a.check_in_time else "",
        }
        for a in recent
    ]

    # Fuller list for the web dashboard's Attendance tab — same records,
    # more fields, shaped to match dashboard.jsx's attendanceRecords
    # (resident/household/center/disasterType/checkIn/checkOut/status).
    # "status" uses a hyphen ("checked-out") to match the
    # status-checked-out CSS class already defined in dashboard.css.
    all_records = (
        Attendance.objects.filter(evacuation_center=center)
        .select_related("family_member", "household", "disaster_type")
        .order_by("-check_in_time")[:50]
    )
    attendance_records = [
        {
            "resident": a.family_member.full_name,
            "household": f"{a.household.full_name} Household",
            "center": center.name,
            "disasterType": a.disaster_type.disaster_type_name if a.disaster_type else "—",
            "checkIn": _format_ph(a.check_in_time, "%b %d, %Y %I:%M %p") if a.check_in_time else "—",
            "checkOut": _format_ph(a.check_out_time, "%b %d, %Y %I:%M %p") if a.check_out_time else "—",
            "status": "present" if a.attendance_status == "Present" else "checked-out",
        }
        for a in all_records
    ]

    disaster_types = [
        {"id": dt.id, "name": dt.disaster_type_name}
        for dt in DisasterType.objects.filter(status="active").order_by("-start_date", "disaster_type_name")
    ]

    return JsonResponse({
        "staff_name": username_param,
        "evacuation_center": {
            "id": center.id,
            "name": center.name,
            "barangay": center.barangay,
            "occupancy": center.current_occupancy,
            "capacity": center.capacity,
            "status": center.status,
        },
        "evacuation_centers": evacuation_centers,
        "today_checkins": today_checkins,
        "recent_checkins": recent_checkins,
        "attendance_records": attendance_records,
        "disaster_types": disaster_types,
    })


@csrf_exempt
def attendance_scan(request):
    """POST body: { "username": "<staff username>", "qr_code": "<FamilyMember.qr_code>",
    "disaster_type_id": <optional int> }

    Looks up the resident by the QR token QRCodeScreen.js renders, finds
    the scanning staff member's assigned evacuation center (same
    barangay-scoping as barangay_dashboard), and toggles the resident
    checked-in / checked-out. Also keeps EvacuationCenter.current_occupancy
    in sync so the dashboard occupancy bar stays accurate. disaster_type_id
    (from the picker in ScannerScreen.js) is only applied on check-in,
    since a check-out updates the same Attendance row that was already
    tagged when the resident checked in."""

    from django.utils import timezone
    from .models import EvacuationCenter, Attendance, DisasterType

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required."}, status=405)

    try:
        data = json.loads(request.body)
        username_param = (data.get("username") or "").strip()
        qr_code = (data.get("qr_code") or "").strip()
        disaster_type_id = data.get("disaster_type_id")

        valid_barangay = _barangay_for_username(username_param)
        if not valid_barangay:
            return JsonResponse({
                "message": "Couldn't determine your assigned barangay. Please log in again.",
            }, status=403)

        center = (
            EvacuationCenter.objects
            .filter(barangay__iexact=valid_barangay)
            .order_by("id")
            .first()
        )
        if not center:
            return JsonResponse({
                "message": f"No evacuation center is set up yet for {valid_barangay}.",
            }, status=404)

        try:
            member = FamilyMember.objects.select_related("household").get(qr_code=qr_code)
        except FamilyMember.DoesNotExist:
            return JsonResponse({"message": "QR code not recognized."}, status=404)

        existing = (
            Attendance.objects.filter(
                family_member=member,
                evacuation_center=center,
                attendance_status="Present",
            )
            .order_by("-check_in_time")
            .first()
        )

        if existing:
            existing.check_out_time = timezone.now()
            existing.attendance_status = "Checked Out"
            existing.save()
            center.current_occupancy = max(0, center.current_occupancy - 1)
            center.save()
            return JsonResponse({
                "action": "checked_out",
                "member_name": member.full_name,
                "household_name": f"{member.household.full_name} Household",
                "time": _format_ph(existing.check_out_time, "%b %d, %Y %I:%M %p"),
            })

        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first() if disaster_type_id else None

        record = Attendance.objects.create(
            family_member=member,
            household=member.household,
            evacuation_center=center,
            disaster_type=disaster_type,
            check_in_time=timezone.now(),
            attendance_status="Present",
        )
        center.current_occupancy += 1
        center.save()

        return JsonResponse({
            "action": "checked_in",
            "member_name": member.full_name,
            "household_name": f"{member.household.full_name} Household",
            "time": _format_ph(record.check_in_time, "%b %d, %Y %I:%M %p"),
            "disaster_type": disaster_type.disaster_type_name if disaster_type else "",
        })

    except Exception as e:
        return JsonResponse({"message": str(e)}, status=500)

@csrf_exempt
def purok_dashboard(request):
    """Real household registrations for the Purok President to review.
    Previously returned hardcoded demo families — now pulls from the
    Household/FamilyMember records created via register_resident +
    register_complete.

    Purok Presidents created via `create_purok_presidents` are scoped to
    one specific purok (Last Name in Django admin > Users), not just a
    barangay, so households_qs is filtered down to that purok
    automatically. The ?purok= query param is kept as a manual
    override/fallback for legacy accounts that aren't purok-scoped yet.

    TODO: flood_advisory still needs a real Advisory/Disaster model.
    """

    if request.method == "OPTIONS":
        return _cors_preflight()

    purok_filter = (request.GET.get("purok") or "").strip()
    username_param = (request.GET.get("username") or "").strip()
    # Kept as a manual override/fallback for testing, but the normal path
    # is deriving barangay from the logged-in username below.
    barangay_override = (request.GET.get("barangay") or "").strip()

    valid_barangay = _barangay_for_username(username_param) or _match_barangay(barangay_override)

    if not valid_barangay:
        return JsonResponse({
            "purok": purok_filter or "All Puroks",
            "barangay": "",
            "flood_advisory": False,
            "total_households": 0,
            "unregistered_households": 0,
            "households": [],
            "message": (
                "Couldn't determine this account's barangay. "
                "Set its First Name in Django admin > Users to its barangay (e.g. 'Tubod')."
            ),
        })

    # An account created by `create_purok_presidents` has its purok
    # pinned via Last Name — that takes priority over the query param
    # so one Purok President can never see another purok's households
    # just by changing the URL.
    assigned_purok = _purok_for_username(username_param, valid_barangay)
    effective_purok = assigned_purok or purok_filter

    households_qs = (
        Household.objects
        .filter(registration_complete=True)
        .prefetch_related("family_members")
        .order_by("-created_at")
    )
    households_qs = households_qs.filter(barangay__iexact=valid_barangay)
    if effective_purok:
        households_qs = households_qs.filter(purok__iexact=effective_purok)

    households = []
    for h in households_qs:
        flags = set()
        member_payload = []

        for m in h.family_members.all():
            tag = None
            if m.is_pwd:
                flags.add("PWD")
                tag = f"PWD - {m.pwd_detail}" if m.pwd_detail else "PWD"
            if m.is_pregnant:
                flags.add("Pregnant")
                tag = f"Pregnant - {m.pregnant_detail}" if m.pregnant_detail else "Pregnant"
            if m.is_elderly:
                flags.add("Elderly")
            if m.is_child_under5:
                flags.add("Child<5")

            member_payload.append({
                "name": m.full_name,
                "relation": m.relation,
                "age": m.age,
                "tag": tag,
            })

        households.append({
            "id": h.household_code,
            "family_name": h.full_name.split(" ")[-1] if h.full_name else "Household",
            "flags": sorted(flags),
            "address": h.address_line or "Address not provided",
            "purok": h.purok or "—",
            "barangay": h.barangay or "—",
            "gps_lat": h.gps_lat,
            "gps_lng": h.gps_lng,
            "submitted": _format_ph(h.created_at, "%b %d, %Y · %I:%M %p"),
            "status": h.status,
            "members": member_payload,
        })

    data = {
        "purok": effective_purok or "All Puroks",
        "barangay": valid_barangay,
        # TODO: replace with a real Advisory/Disaster model.
        "flood_advisory": False,
        "total_households": households_qs.count(),
        "unregistered_households": Household.objects.filter(
            registration_complete=False,
            barangay__iexact=valid_barangay,
        ).count(),
        "households": households,
    }

    return JsonResponse(data)


@csrf_exempt
def purok_review_household(request, household_code):
    """Persists a Purok President's approve/reject decision on a
    household registration. Called by PurokDashboard.jsx after the
    reviewer confirms the action in the confirmation modal."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)
        action = (data.get("action") or "").strip().lower()
        reviewer_username = (data.get("username") or "").strip()

        if action not in ("approve", "reject"):
            return JsonResponse({
                "success": False,
                "message": "action must be 'approve' or 'reject'."
            }, status=400)

        try:
            household = Household.objects.get(household_code=household_code)
        except Household.DoesNotExist:
            return JsonResponse({
                "success": False,
                "message": "Household not found."
            }, status=404)

        # A Purok President can only approve/reject households from their
        # own barangay, resolved from their username (same as the
        # dashboard listing above) rather than trusting a client-sent value.
        reviewer_barangay = _barangay_for_username(reviewer_username)
        if not reviewer_barangay:
            return JsonResponse({
                "success": False,
                "message": "Couldn't determine your assigned barangay. Please log in again."
            }, status=403)

        if household.barangay.lower() != reviewer_barangay.lower():
            return JsonResponse({
                "success": False,
                "message": "This household is registered under a different barangay."
            }, status=403)

        # If this reviewer account is scoped to one specific purok (via
        # create_purok_presidents), it can only act on households from
        # that purok — not just anywhere in the barangay.
        reviewer_purok = _purok_for_username(reviewer_username, reviewer_barangay)
        if reviewer_purok and household.purok.lower() != reviewer_purok.lower():
            return JsonResponse({
                "success": False,
                "message": "This household is registered under a different purok/zone."
            }, status=403)

        if household.status != "pending":
            return JsonResponse({
                "success": False,
                "message": "This household has already been reviewed."
            }, status=400)

        household.status = "approved" if action == "approve" else "rejected"
        household.save()

        return JsonResponse({
            "success": True,
            "household_code": household.household_code,
            "status": household.status,
        })

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)

# ─────────────────────────────────────────────────────────────
# Resident app (GEOAID_resident) — households sign in with a mobile
# number + password rather than a staff username/group, so these
# don't go through authenticate()/GROUP_ROLE_MAP like login_user.
# ─────────────────────────────────────────────────────────────

@csrf_exempt
def register_resident(request):

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)

        full_name = (data.get("full_name") or "").strip()
        mobile_number = (data.get("mobile_number") or "").strip()
        password = data.get("password") or ""

        if not full_name or not mobile_number or not password:
            return JsonResponse({
                "success": False,
                "message": "Full name, mobile number, and password are required."
            }, status=400)

        if len(password) < 8:
            return JsonResponse({
                "success": False,
                "message": "Password must be at least 8 characters."
            }, status=400)

        if Household.objects.filter(mobile_number=mobile_number).exists():
            return JsonResponse({
                "success": False,
                "message": "An account with this mobile number already exists."
            }, status=409)

        household = Household(full_name=full_name, mobile_number=mobile_number)
        household.set_password(password)
        household.save()

        return JsonResponse({
            "success": True,
            "household_code": household.household_code,
            "full_name": household.full_name,
            "mobile_number": household.mobile_number,
        }, status=201)

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)


@csrf_exempt
def login_resident(request):

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)

        mobile_number = (data.get("mobile_number") or "").strip()
        password = data.get("password") or ""

        try:
            household = Household.objects.get(mobile_number=mobile_number)
        except Household.DoesNotExist:
            return JsonResponse({
                "success": False,
                "message": "Invalid mobile number or password."
            }, status=401)

        if not household.check_password(password):
            return JsonResponse({
                "success": False,
                "message": "Invalid mobile number or password."
            }, status=401)

        if not household.registration_complete:
            return JsonResponse({
                "success": False,
                "status": "incomplete",
                "message": "Please finish Steps 2-4 of registration before logging in."
            }, status=403)

        if household.status == "pending":
            return JsonResponse({
                "success": False,
                "status": "pending",
                "message": "Your registration is still awaiting approval from your Purok President. You'll be able to log in once it's approved."
            }, status=403)

        if household.status == "rejected":
            return JsonResponse({
                "success": False,
                "status": "rejected",
                "message": "Your registration was flagged for correction by your Purok President. Please contact them or re-submit your details."
            }, status=403)

        return JsonResponse({
            "success": True,
            "household_code": household.household_code,
            "full_name": household.full_name,
            "mobile_number": household.mobile_number,
        })

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)


@csrf_exempt
def register_complete(request):
    """Steps 2-4 of registration (Household / Members / Vulnerability),
    submitted together by Register.jsx's handleFinish once all four
    steps are filled in. Looks the household up by mobile_number (set
    in Step 1 via register_resident) and fills in address/dwelling
    fields, then (re)creates its FamilyMember rows."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)

        mobile_number = (data.get("mobile_number") or "").strip()
        if not mobile_number:
            return JsonResponse({
                "success": False,
                "message": "mobile_number is required."
            }, status=400)

        try:
            household = Household.objects.get(mobile_number=mobile_number)
        except Household.DoesNotExist:
            return JsonResponse({
                "success": False,
                "message": "No account found for this mobile number. Complete Step 1 first."
            }, status=404)

        members_payload = data.get("members") or []
        if not members_payload:
            return JsonResponse({
                "success": False,
                "message": "At least one household member is required."
            }, status=400)

        for m in members_payload:
            if not (m.get("full_name") or "").strip():
                return JsonResponse({
                    "success": False,
                    "message": "Every member needs a full name."
                }, status=400)
            try:
                int(m.get("age"))
            except (TypeError, ValueError):
                return JsonResponse({
                    "success": False,
                    "message": f"Invalid age for {m.get('full_name', 'a member')}."
                }, status=400)

        household.barangay = data.get("barangay") or ""
        household.purok = data.get("purok") or ""
        household.address_line = data.get("address_line") or ""
        household.landmark = data.get("landmark") or ""
        household.dwelling_type = data.get("dwelling_type") or ""
        household.gps_lat = data.get("gps_lat")
        household.gps_lng = data.get("gps_lng")
        household.registration_complete = True
        household.save()

        # Steps 3-4 are re-submitted together as one array each time,
        # so replace any previously-saved members rather than appending.
        household.family_members.all().delete()

        created = []
        for m in members_payload:
            created.append(FamilyMember.objects.create(
                household=household,
                full_name=m.get("full_name").strip(),
                age=int(m.get("age")),
                relation=m.get("relation") or "Other",
                is_pwd=bool(m.get("is_pwd")),
                pwd_detail=(m.get("pwd_detail") or "").strip(),
                is_pregnant=bool(m.get("is_pregnant")),
                pregnant_detail=(m.get("pregnant_detail") or "").strip(),
                # Opaque per-member token for evacuation-center QR check-in.
                # Random/unguessable on purpose — never derived from name or
                # mobile number, since the QR code is shown/printed openly.
                qr_code=uuid.uuid4().hex,
            ))

        return JsonResponse({
            "success": True,
            "household_code": household.household_code,
            "member_count": len(created),
        }, status=201)

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)


def register_lookups(request):
    """Barangay + purok + dwelling type options for HouseholdStep.jsx's
    dropdowns. Barangay names come live from the Barangay table (Django
    admin > Barangays) — add or remove one there and it shows up here
    automatically, no code changes needed."""

    return JsonResponse({
        "barangays": list(Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)),
        "puroks": Household.PUROK_CHOICES_BY_BARANGAY,
        "dwelling_types": [
            {"value": value, "label": label}
            for value, label in Household.DWELLING_TYPE_CHOICES
        ],
    })


@csrf_exempt
def resident_dashboard(request):

    if request.method == "OPTIONS":
        return _cors_preflight()

    mobile_number = request.GET.get("mobile_number", "")

    try:
        household = Household.objects.get(mobile_number=mobile_number)
    except Household.DoesNotExist:
        return JsonResponse({
            "success": False,
            "message": "Household not found."
        }, status=404)

    if household.status not in ("approved", "confirmed"):
        return JsonResponse({
            "success": False,
            "status": household.status,
            "message": "Your registration is not yet approved by your Purok President."
        }, status=403)

    members = []
    for member in household.family_members.all():
        flags = []
        if member.is_pwd:
            flags.append("PWD")
        if member.is_pregnant:
            flags.append("Pregnant")
        if member.is_elderly:
            flags.append("Elderly")
        if member.is_child_under5:
            flags.append("Child<5")

        members.append({
            "id": member.id,
            "name": member.full_name,
            "role": "Head of Household" if member.relation == "Head" else member.relation,
            "flags": flags,
            # Sent as "qr_token" to match what QRCodeScreen.js expects.
            "qr_token": member.qr_code,
        })

    household_name = f"{household.full_name.split(' ')[-1]} Household" if household.full_name else "Household"

    # Nearest evacuation center via the same Dijkstra routing DRRM uses
    # (_nearest_route_from_point / routing.py) starting from the
    # household's saved location — no live GPS fix available on this
    # endpoint, so the map screen (which does have GPS) is what refines
    # this further and draws the actual path.
    nearest_center = None
    lat, lng, _source = _household_location(household)
    if lat is not None:
        recommended, _alternatives, _message = _nearest_route_from_point(lat, lng)
        if recommended:
            c = recommended["center"]
            nearest_center = {
                "id": c["id"],
                "name": c["name"],
                "distance_km": recommended["distance_km"],
                "walk_minutes": recommended["est_minutes"],
                "status": c["status"],
                "occupancy": c["occupancy"],
                "capacity": c["capacity"],
            }

    if nearest_center is None:
        # Fall back to a placeholder only when no route/coordinates exist
        # yet (e.g. DRRM hasn't pinned any evacuation routes), so the Home
        # screen still has something sensible to show.
        nearest_center = {
            "name": "Tibanga Gymnasium",
            "distance_km": 0.8,
            "walk_minutes": 10,
            "status": "open",
            "occupancy": 87,
            "capacity": 300,
        }

    data = {
        "household_id": household.id,
        "household_name": household_name,
        "unread_alerts": 2,
        # TODO: replace with a real Advisory/Disaster model + geo lookup.
        "advisory": {
            "title": "Flood Advisory — Tibanga",
            "body": "PAGASA: Heavy rainfall expected. Prepare go-bag. Issued 7:45 AM",
        },
        "nearest_center": nearest_center,
        "members": members,
    }

    return JsonResponse(data)


@csrf_exempt
def resident_registration_status(request):
    """Used by RegistrationStatusScreen.js — returns the household's
    current review status (pending / approved / confirmed / rejected)
    plus the basic household details the screen displays."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    mobile_number = (request.GET.get("mobile_number") or "").strip()

    household = Household.objects.filter(mobile_number=mobile_number).first()
    if not household:
        return JsonResponse({"success": False, "message": "Household not found."}, status=404)

    return JsonResponse({
        "success": True,
        "status": household.status,
        "household": {
            "household_code": household.household_code,
            "barangay": household.barangay,
            "purok": household.purok,
            "submitted": _format_ph(household.created_at, "%b %d, %Y"),
        },
    })


@csrf_exempt
def resident_relief_distribution(request):
    """Used by ReliefDistributionScreen.js — the household's relief
    releases (ReliefDistribution). Inventory/stock levels are CSWD-side
    only and are intentionally not exposed here. Cancelled releases are
    hidden from the resident."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    mobile_number = (request.GET.get("mobile_number") or "").strip()

    household = Household.objects.filter(mobile_number=mobile_number).first()
    if not household:
        return JsonResponse({"success": False, "message": "Household not found."}, status=404)

    # The releases the barangay gave to this household (barangay-level
    # batches are not shown to residents).
    records = list(
        ReliefDistribution.objects
        .filter(household=household)
        .exclude(claim_status="cancelled")
        .select_related("barangay")
        .order_by("-distribution_date", "-id")
    )

    def _serialize(r):
        return {
            "id": r.id,
            "date": _format_ph(r.distribution_date, "%b %d, %Y"),
            "goods_type": r.get_goods_type_display(),
            "quantity": r.quantity_given,
            "status": r.claim_status,
            "distributed_by": r.distributed_by,
            "tracking_number": r.tracking_number,
            "remarks": r.remarks,
            "claimed_at": _format_ph(r.claimed_at, "%b %d, %Y %I:%M %p"),
            # Barangay-level releases are marked received by CSWD, so the
            # resident has nothing to confirm on those.
            "scope": "household" if r.household_id else "barangay",
            "barangay": r.barangay.barangay_name if r.barangay else "",
        }

    history = [_serialize(r) for r in records]
    last_claimed = next((r for r in records if r.claim_status == "claimed"), None)

    # Headline status for the top card: something to pick up first, then
    # something being prepared, then what was already received. Only the
    # household's own "ready" releases show as "ready" (that is what
    # triggers the app's confirm button); barangay-level ones show as
    # "processing" until CSWD marks them received.
    if any(r.claim_status == "ready" and r.household_id for r in records):
        status = "ready"
    elif any(r.claim_status in ("processing", "pending", "ready") for r in records):
        status = "processing"
    elif last_claimed:
        status = "received"
    elif household.status == "confirmed":
        status = "pending"  # eligible, waiting for an allocation
    else:
        status = "not_eligible"

    return JsonResponse({
        "success": True,
        "status": status,
        "last_distribution": _serialize(last_claimed) if last_claimed else None,
        "distribution_history": history,
    })


@csrf_exempt
def resident_confirm_relief(request):
    """Used by ReliefDistributionScreen.js — the resident confirms in the
    app that their household received the relief goods. Only a release
    CSWD has marked "ready" for pickup can be confirmed (not one that is
    still processing), and only by the household it belongs to."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    mobile_number = (payload.get("mobile_number") or "").strip()
    household = Household.objects.filter(mobile_number=mobile_number).first()
    if not household:
        return JsonResponse({"success": False, "message": "Household not found."}, status=404)

    try:
        relief_id = int(payload.get("id"))
    except (TypeError, ValueError):
        return JsonResponse({"success": False, "message": "A valid relief release id is required."}, status=400)

    with transaction.atomic():
        relief = (
            ReliefDistribution.objects.select_for_update()
            .filter(id=relief_id, household=household).first()
        )
        if not relief:
            return JsonResponse({"success": False, "message": "Relief release not found."}, status=404)

        if relief.claim_status == "claimed":
            return JsonResponse({"success": False, "message": "You already confirmed receiving this relief."}, status=400)

        if relief.claim_status == "cancelled":
            return JsonResponse({"success": False, "message": "This relief release was cancelled."}, status=400)

        if relief.claim_status != "ready":
            return JsonResponse({
                "success": False,
                "message": "Your relief is still being processed. You can confirm receipt once CSWD marks it Ready for Pickup.",
            }, status=400)

        relief.claim_status = "claimed"
        relief.claimed_at = timezone.now()
        relief.status_updated_by = "resident"
        relief.save()

    return JsonResponse({
        "success": True,
        "message": "Thank you! Your relief receipt has been confirmed.",
        "relief": {
            "id": relief.id,
            "status": relief.claim_status,
            "claimed_at": _format_ph(relief.claimed_at, "%b %d, %Y %I:%M %p"),
        },
    })


def _serialize_profile(household):
    """Shape ProfileScreen.js reads: household info, contact info, and
    the household's members with vulnerability flags."""
    members = []
    for m in household.family_members.all():
        flags = []
        if m.is_pwd:
            flags.append("PWD")
        if m.is_pregnant:
            flags.append("Pregnant")
        if m.is_elderly:
            flags.append("Elderly")
        if m.is_child_under5:
            flags.append("Child<5")
        members.append({
            "full_name": m.full_name,
            "relation": "Head of Household" if m.relation == "Head" else m.relation,
            "age": m.age,
            "flags": flags,
        })

    return {
        "household_code": household.household_code,
        "barangay": household.barangay,
        "purok": household.purok,
        "status": household.status,
        "full_name": household.full_name,
        "mobile_number": household.mobile_number,
        "address_line": household.address_line,
        "landmark": household.landmark,
        "members": members,
    }


@csrf_exempt
def resident_profile(request):
    """Used by ProfileScreen.js — the resident's household profile.
    Works for every registration status (pending / approved / confirmed /
    rejected), unlike resident_dashboard, so residents can always see
    where their registration stands."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET required."}, status=405)

    mobile_number = (request.GET.get("mobile_number") or "").strip()
    household = (
        Household.objects.filter(mobile_number=mobile_number)
        .prefetch_related("family_members")
        .first()
    )
    if not household:
        return JsonResponse({"success": False, "message": "Household not found."}, status=404)

    return JsonResponse(_serialize_profile(household))


@csrf_exempt
def resident_profile_update(request):
    """Used by ProfileScreen.js — updates full name, address and landmark.
    The mobile number is the resident's login ID, so it is never changed
    here even if the app sends a different one."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    mobile_number = (payload.get("mobile_number") or "").strip()
    household = (
        Household.objects.filter(mobile_number=mobile_number)
        .prefetch_related("family_members")
        .first()
    )
    if not household:
        return JsonResponse({"success": False, "message": "Household not found."}, status=404)

    if "full_name" in payload:
        full_name = (payload.get("full_name") or "").strip()
        if not full_name:
            return JsonResponse({"message": "Full name can't be empty."}, status=400)
        if len(full_name) > 150:
            return JsonResponse({"message": "Full name is too long (150 characters max)."}, status=400)
        household.full_name = full_name

    for field in ("address_line", "landmark"):
        if field in payload:
            value = (payload.get(field) or "").strip()
            if len(value) > 255:
                return JsonResponse({"message": f"{field.replace('_', ' ').capitalize()} is too long (255 characters max)."}, status=400)
            setattr(household, field, value)

    household.save()
    return JsonResponse(_serialize_profile(household))


# =====================================================================
# PDF REPORTS  (paste at the very bottom of views.py)
# =====================================================================

# ------------------------------------------------------------------ styles
NAVY = colors.HexColor("#12355B")
TEAL = colors.HexColor("#1B8A8F")
LIGHT = colors.HexColor("#EAF3F4")
GREY = colors.HexColor("#5A6672")
LINE = colors.HexColor("#C9D5DB")
RED = colors.HexColor("#B42318")

_base = ParagraphStyle("b", fontName="Helvetica", fontSize=9.5, leading=14,
                       textColor=colors.HexColor("#1F2933"))
H1 = ParagraphStyle("h1", parent=_base, fontName="Helvetica-Bold", fontSize=13,
                    leading=17, textColor=NAVY, spaceBefore=12, spaceAfter=5)
CELL = ParagraphStyle("c", parent=_base, fontSize=8.3, leading=11)
CELLB = ParagraphStyle("cb", parent=CELL, fontName="Helvetica-Bold", textColor=colors.white)
NOTE = ParagraphStyle("n", parent=_base, fontSize=8.5, leading=12, textColor=GREY)

PAGE_W = A4[0] - 36 * mm  # usable width


def _p(text, style=_base):
    return Paragraph(escape(str(text)) if text is not None else "", style)


def _table(head, rows, widths, empty="No records."):
    if not rows:
        return _p(empty, NOTE)
    data = [[Paragraph(escape(h), CELLB) for h in head]]
    data += [[Paragraph(escape(str(c)), CELL) for c in r] for r in rows]
    t = Table(data, colWidths=[w * PAGE_W for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT]),
        ("GRID", (0, 0), (-1, -1), 0.4, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5), ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]))
    return t


def _kpis(pairs):
    """Row of big-number boxes: [(label, value), ...]"""
    n = len(pairs)
    cells = [[Paragraph(
        f'<font size="17" color="#12355B"><b>{escape(str(v))}</b></font><br/>'
        f'<font size="7.5" color="#5A6672">{escape(l)}</font>',
        ParagraphStyle("k", parent=_base, leading=20, alignment=1)) for l, v in pairs]]
    t = Table(cells, colWidths=[PAGE_W / n] * n)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.6, LINE), ("INNERGRID", (0, 0), (-1, -1), 0.6, LINE),
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
    ]))
    return t


def _section(title, *flowables):
    return [KeepTogether([Paragraph(escape(title), H1)] + list(flowables[:1]))] + list(flowables[1:])


class _NumberedCanvas(rl_canvas.Canvas):
    """Adds 'Page x of y' and the footer to every page."""
    footer_text = "GeoAid"

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self._saved = []

    def showPage(self):
        self._saved.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        total = len(self._saved)
        for state in self._saved:
            self.__dict__.update(state)
            self.setFont("Helvetica", 8)
            self.setFillColor(GREY)
            self.setStrokeColor(LINE)
            self.line(18 * mm, 14 * mm, A4[0] - 18 * mm, 14 * mm)
            self.drawString(18 * mm, 9.5 * mm, self.footer_text)
            self.drawRightString(A4[0] - 18 * mm, 9.5 * mm, f"Page {self._pageNumber} of {total}")
            super().showPage()
        super().save()


# ------------------------------------------------------------ data helpers
def _flags_for(household):
    flags = set()
    for m in household.family_members.all():
        if m.is_pwd:
            flags.add("PWD")
        if m.is_pregnant:
            flags.add("Pregnant")
        if m.is_elderly:
            flags.add("Elderly")
        if m.is_child_under5:
            flags.add("Child<5")
    return ", ".join(sorted(flags)) or "-"


def _vulnerability_counts(hh_qs):
    members = FamilyMember.objects.filter(household__in=hh_qs)
    return {
        "members": members.count(),
        "senior": members.filter(age__gte=60).count(),
        "pwd": members.filter(is_pwd=True).count(),
        "pregnant": members.filter(is_pregnant=True).count(),
        "child": members.filter(age__lt=5).count(),
    }


# --------------------------------------------------------------- sections
def sec_registration(hh_qs, incomplete_qs=None):
    c = {s: hh_qs.filter(status=s).count() for s in ("pending", "approved", "confirmed", "rejected")}
    out = [_kpis([("Total registered", sum(c.values())), ("Pending (Purok)", c["pending"]),
                  ("Awaiting Barangay", c["approved"]), ("Confirmed", c["confirmed"]),
                  ("Rejected", c["rejected"])])]
    if incomplete_qs is not None:
        out += [Spacer(1, 3), _p(f"Households that started but did not finish registration: {incomplete_qs.count()}", NOTE)]
    return _section("Household Registration Status", *out)


def sec_vulnerability(hh_qs):
    v = _vulnerability_counts(hh_qs)
    return _section(
        "Vulnerability Profile",
        _kpis([("Members", v["members"]), ("Senior 60+", v["senior"]), ("PWD", v["pwd"]),
               ("Pregnant", v["pregnant"]), ("Children <5", v["child"])]),
    )


def sec_households(hh_qs, title="Household List", limit=80):
    hh = list(hh_qs.prefetch_related("family_members").order_by("barangay", "purok", "full_name")[:limit + 1])
    more = len(hh) > limit
    rows = [[h.household_code, h.full_name, h.barangay or "-", h.purok or "-",
             h.family_members.count(), _flags_for(h), h.get_status_display()] for h in hh[:limit]]
    out = [_table(["Code", "Representative", "Barangay", "Purok", "Members", "Priority flags", "Status"],
                  rows, [.14, .18, .11, .12, .11, .17, .17], "No households.")]
    if more:
        out.append(_p(f"Showing the first {limit} households only.", NOTE))
    return _section(title, *out)


def sec_by_barangay(hh_qs):
    rows = []
    for b in Barangay.objects.order_by("barangay_name"):
        h = hh_qs.filter(barangay__iexact=b.barangay_name)
        n = h.count()
        if not n:
            continue
        v = _vulnerability_counts(h)
        rows.append([b.barangay_name, n, v["members"], v["senior"], v["pwd"], v["pregnant"], v["child"]])
    return _section("Households by Barangay",
                    _table(["Barangay", "Households", "Members", "Senior", "PWD", "Pregnant", "Child<5"],
                           rows, [.28, .16, .14, .11, .10, .11, .10], "No confirmed households yet."))


def _relief_qs(hh_qs, disaster_id=None):
    # Household-level (legacy) releases for these households, plus the
    # barangay-level releases for the barangays they belong to.
    barangays = list(hh_qs.values_list("barangay", flat=True).distinct())  # names
    qs = (
        ReliefDistribution.objects
        .filter(Q(household__in=hh_qs) | Q(household__isnull=True, barangay__barangay_name__in=barangays))
        .select_related("household", "disaster_type", "barangay")
    )
    if disaster_id:
        qs = qs.filter(disaster_type_id=disaster_id)
    return qs


def sec_relief(hh_qs, disaster_id=None, title="Relief Distribution", recent=25):
    all_qs = _relief_qs(hh_qs, disaster_id)
    # Totals use the barangay batches + legacy direct releases; the goods
    # barangays hand to households are part of those batches.
    qs = all_qs.filter(Q(household__isnull=True) | Q(barangay__isnull=True))
    live = qs.exclude(claim_status="cancelled")
    total = live.aggregate(t=Sum("quantity_given"))["t"] or 0
    claimed = live.filter(claim_status="claimed").aggregate(t=Sum("quantity_given"))["t"] or 0
    kp = _kpis([("Releases", live.count()), ("Quantity released", total),
                ("Quantity claimed", claimed),
                ("Barangays served", live.filter(barangay__isnull=False).values("barangay").distinct().count()),
                ("Households given relief", all_qs.exclude(claim_status="cancelled")
                 .filter(household__isnull=False).values("household").distinct().count())])
    by_status = [[dict(ReliefDistribution.CLAIM_STATUS_CHOICES).get(r["claim_status"], r["claim_status"]),
                  r["n"], r["q"] or 0]
                 for r in qs.values("claim_status").annotate(n=Count("id"), q=Sum("quantity_given")).order_by("claim_status")]
    by_goods = [[(r["goods_type"] or "").capitalize(), r["n"], r["q"] or 0]
                for r in live.values("goods_type").annotate(n=Count("id"), q=Sum("quantity_given")).order_by("goods_type")]
    last = [[r.tracking_number,
             r.household.full_name if r.household else f"Brgy. {r.barangay.barangay_name if r.barangay else '-'} ({r.households_served} hh)",
             (r.household.barangay if r.household else (r.barangay.barangay_name if r.barangay else "")) or "-", r.get_goods_type_display(),
             r.quantity_given, r.get_claim_status_display(), _format_ph(r.distribution_date, "%b %d, %Y")]
            for r in all_qs.order_by("-distribution_date")[:recent]]
    return _section(
        title, kp, Spacer(1, 6),
        _table(["Claim status", "Releases", "Quantity"], by_status, [.5, .25, .25], "No relief records."),
        Spacer(1, 6),
        _table(["Goods type", "Releases", "Quantity"], by_goods, [.5, .25, .25], "No relief records."),
        Spacer(1, 6), _p(f"Most recent releases (up to {recent})", NOTE),
        _table(["Tracking no.", "Recipient", "Barangay", "Goods", "Qty", "Status", "Date"],
               last, [.25, .19, .11, .09, .07, .14, .15], "No relief records."),
    )


def sec_stock():
    rows = [[s.get_goods_type_display(), s.quantity, _format_ph(s.updated_at)] for s in ReliefStock.objects.all()]
    return _section("Relief Goods Storage (current stock)",
                    _table(["Goods type", "Quantity on hand", "Last updated"], rows, [.4, .3, .3], "No stock recorded."))


def sec_donations(disaster_id=None, recent=20):
    qs = Donation.objects.select_related("disaster_type")
    if disaster_id:
        qs = qs.filter(disaster_type_id=disaster_id)
    by_status = [[dict(Donation.STATUS_CHOICES).get(r["status"], r["status"]), r["n"], r["q"] or 0]
                 for r in qs.values("status").annotate(n=Count("id"), q=Sum("quantity")).order_by("status")]
    last = [[d.donor_name, d.goods_type, d.quantity, d.donation_date.strftime("%b %d, %Y") if d.donation_date else "-",
             d.get_status_display(), d.disaster_type.disaster_type_name if d.disaster_type else "-"]
            for d in qs[:recent]]
    return _section(
        "Donations",
        _kpis([("Donations logged", qs.count()), ("Total quantity", qs.aggregate(t=Sum("quantity"))["t"] or 0)]),
        Spacer(1, 6),
        _table(["Status", "Donations", "Quantity"], by_status, [.5, .25, .25], "No donations."),
        Spacer(1, 6), _p(f"Most recent donations (up to {recent})", NOTE),
        _table(["Donor", "Goods", "Qty", "Date", "Status", "Disaster"], last, [.24, .17, .08, .15, .14, .22], "No donations."),
    )


def sec_centers(barangay=None):
    qs = EvacuationCenter.objects.order_by("barangay", "name")
    if barangay:
        qs = qs.filter(barangay__iexact=barangay)
    rows = []
    for c in qs:
        pct = round(c.current_occupancy / c.capacity * 100) if c.capacity else 0
        rows.append([c.name, c.barangay, f"{c.current_occupancy} / {c.capacity}", f"{pct}%", c.get_status_display()])
    return _section("Evacuation Centers",
                    _table(["Center", "Barangay", "Occupancy", "Used", "Status"], rows, [.32, .22, .16, .12, .18],
                           "No evacuation centers."))


def sec_attendance(barangay=None, disaster_id=None):
    start = timezone.localtime(timezone.now()).replace(hour=0, minute=0, second=0, microsecond=0)
    qs = Attendance.objects.filter(check_in_time__gte=start).select_related("family_member", "evacuation_center")
    if barangay:
        qs = qs.filter(evacuation_center__barangay__iexact=barangay)
    if disaster_id:
        qs = qs.filter(disaster_type_id=disaster_id)
    rows = [[a.family_member.full_name, a.evacuation_center.name, _format_ph(a.check_in_time, "%I:%M %p"),
             _format_ph(a.check_out_time, "%I:%M %p") or "-", a.attendance_status]
            for a in qs.order_by("-check_in_time")[:60]]
    return _section(
        "Evacuation Attendance (today)",
        _kpis([("Check-ins today", qs.count()), ("Currently present", qs.filter(attendance_status="Present").count()),
               ("Checked out", qs.filter(attendance_status="Checked Out").count())]),
        Spacer(1, 6),
        _table(["Name", "Center", "Check-in", "Check-out", "Status"], rows, [.28, .27, .13, .13, .19], "No check-ins today."),
    )


def sec_disasters():
    rows = [[d.disaster_type_name, d.start_date or "-", d.end_date or "-", d.get_status_display(),
             d.relief_distributions.count(), d.donations.count(), d.attendance_records.count()]
            for d in DisasterType.objects.order_by("-start_date", "disaster_type_name")]
    return _section("Disaster Situations",
                    _table(["Disaster", "Start", "End", "Status", "Relief", "Donations", "Check-ins"],
                           rows, [.28, .13, .13, .11, .10, .13, .12], "No disaster situations recorded."))


def sec_routes():
    qs = EvacuationRoute.objects.select_related("evacuation_center")
    rows = [[r.start_location, r.evacuation_center.name, r.route_distance or "-", r.estimated_time or "-",
             r.get_road_condition_display(), r.get_route_status_display()] for r in qs[:60]]
    return _section("Evacuation Routes",
                    _table(["From", "To center", "Distance", "Est. time", "Road condition", "Route status"],
                           rows, [.22, .24, .11, .11, .16, .16], "No routes pinned."))


def sec_written(w):
    """The title / content typed into the Generate Report form."""
    title = Paragraph(escape(w["title"]), ParagraphStyle(
        "wt", parent=_base, fontName="Helvetica-Bold", fontSize=15, leading=19,
        textColor=NAVY, spaceBefore=10, spaceAfter=3))
    meta = f"Disaster: {w['disaster']}" if w["disaster"] else ""
    body = Paragraph(escape(w["content"]).replace("\n", "<br/>"), _base)
    return [title] + ([_p(meta, NOTE)] if meta else []) + [Spacer(1, 5), body, Spacer(1, 6)]


def sec_resident(h):
    prof = [
        ["Household code", h.household_code], ["Representative", h.full_name], ["Mobile", h.mobile_number],
        ["Barangay / Purok", f"{h.barangay or '-'} / {h.purok or '-'}"],
        ["Address", h.address_line or "-"], ["Landmark", h.landmark or "-"],
        ["Dwelling", h.get_dwelling_type_display() or "-"],
        ["Registration status", h.get_status_display()],
    ]
    members = [[m.full_name, m.get_relation_display(), m.age,
                ", ".join(f for f in ["PWD" if m.is_pwd else "", "Pregnant" if m.is_pregnant else "",
                                      "Elderly" if m.is_elderly else "", "Child<5" if m.is_child_under5 else ""] if f) or "-"]
               for m in h.family_members.all()]
    relief = [[r.tracking_number, r.get_goods_type_display(), r.quantity_given, r.get_claim_status_display(),
               _format_ph(r.distribution_date, "%b %d, %Y")]
              for r in ReliefDistribution.objects
              .filter(Q(household=h))
              .exclude(claim_status="cancelled").order_by("-distribution_date")]
    att = [[a.family_member.full_name, a.evacuation_center.name, _format_ph(a.check_in_time),
            _format_ph(a.check_out_time) or "-", a.attendance_status]
           for a in h.attendance_records.select_related("family_member", "evacuation_center").order_by("-check_in_time")[:15]]
    return (
        _section("My Household", _table(["Item", "Details"], prof, [.3, .7]))
        + _section("Household Members", _table(["Name", "Relation", "Age", "Priority"], members, [.38, .22, .1, .3]))
        + _section("My Relief Goods", _table(["Tracking no.", "Goods", "Qty", "Status", "Date"], relief,
                                             [.28, .16, .1, .26, .2], "No relief received yet."))
        + _section("My Evacuation Check-ins", _table(["Member", "Center", "Check-in", "Check-out", "Status"], att,
                                                      [.22, .22, .22, .22, .12], "No check-ins."))
    )


# --------------------------------------------------------- who is asking?
ROLE_LABEL = {
    "resident": "Resident", "purok": "Purok President", "barangay": "Barangay Staff",
    "cswd": "CSWD Personnel", "drrm": "DRRM Officer", "admin": "Administrator",
}


def _resolve_requester(mobile="", username=""):
    """Returns (ctx dict, None) or (None, JsonResponse error)."""
    mobile = (mobile or "").strip()
    username = (username or "").strip()

    if mobile:
        h = Household.objects.filter(mobile_number=mobile).first()
        if not h:
            return None, JsonResponse({"success": False, "message": "Household not found."}, status=404)
        return {"role": "resident", "name": h.full_name, "household": h, "user": None,
                "scope": f"Household {h.household_code}"}, None

    if not username:
        return None, JsonResponse({"success": False, "message": "username or mobile_number is required."}, status=400)

    user = User.objects.filter(username=username).first()
    if not user:
        return None, JsonResponse({"success": False, "message": "User not found."}, status=404)

    role = ""
    g = user.groups.first()
    if g:
        role = GROUP_ROLE_MAP.get(g.name.strip().lower(), "")
    if not role and user.is_superuser:
        role = "admin"
    if not role:
        return None, JsonResponse({"success": False, "message": "This account has no recognized role."}, status=403)

    ctx = {"role": role, "name": user.get_full_name() or user.username, "user": user,
           "barangay": "", "purok": "", "scope": "City-wide"}
    if role in ("purok", "barangay"):
        ctx["barangay"] = _match_barangay(user.first_name)
        if not ctx["barangay"]:
            return None, JsonResponse({"success": False,
                "message": "Set this account's First Name to its barangay in Django admin > Users."}, status=403)
        ctx["scope"] = f"Brgy. {ctx['barangay']}"
        if role == "purok":
            ctx["purok"] = _purok_for_username(username, ctx["barangay"])
            if ctx["purok"]:
                ctx["scope"] += f", {ctx['purok']}"
    return ctx, None


# ------------------------------------------------------------- PDF builder
def build_report_pdf(ctx, disaster_id=None, written=None):
    role = ctx["role"]
    now = _format_ph(timezone.now(), "%B %d, %Y %I:%M %p")
    disaster = DisasterType.objects.filter(pk=disaster_id).first() if disaster_id else None

    complete = Household.objects.filter(registration_complete=True)
    confirmed = complete.filter(status="confirmed")
    story = sec_written(written) if written else []

    if role == "resident":
        story += sec_resident(ctx["household"])
        title = "Household Report"
    elif role == "purok":
        qs = complete.filter(barangay__iexact=ctx["barangay"])
        if ctx["purok"]:
            qs = qs.filter(purok__iexact=ctx["purok"])
        story += sec_registration(qs)
        story += sec_vulnerability(qs)
        story += sec_households(qs)
        story += sec_relief(qs, disaster_id)
        title = "Purok Registration Report"
    elif role == "barangay":
        b = ctx["barangay"]
        qs = complete.filter(barangay__iexact=b)
        story += sec_registration(qs, Household.objects.filter(registration_complete=False, barangay__iexact=b))
        story += sec_vulnerability(qs.filter(status="confirmed"))
        story += sec_households(qs.exclude(status="pending"), "Households (reviewed by Purok President)")
        story += sec_relief(qs, disaster_id)
        story += sec_centers(b)
        story += sec_attendance(b, disaster_id)
        title = "Barangay Report"
    elif role == "cswd":
        story += sec_registration(confirmed)
        story += sec_vulnerability(confirmed)
        story += sec_by_barangay(confirmed)
        story += sec_relief(confirmed, disaster_id)
        story += sec_stock()
        story += sec_donations(disaster_id)
        story += sec_centers()
        story += sec_disasters()
        title = "CSWD Relief & Vulnerability Report"
    elif role == "drrm":
        story += sec_registration(confirmed)
        story += sec_vulnerability(confirmed)
        story += sec_by_barangay(confirmed)
        story += sec_disasters()
        story += sec_centers()
        story += sec_routes()
        story += sec_attendance(None, disaster_id)
        title = "DRRM Situation Report"
    else:  # admin: everything
        story += sec_registration(complete, Household.objects.filter(registration_complete=False))
        story += sec_vulnerability(confirmed)
        story += sec_by_barangay(confirmed)
        story += sec_relief(complete, disaster_id)
        story += sec_stock()
        story += sec_donations(disaster_id)
        story += sec_disasters()
        story += sec_centers()
        story += sec_routes()
        story += sec_attendance(None, disaster_id)
        title = "GeoAid System Report"

    head = Table([[Paragraph(
        f'<font color="white" size="16"><b>GeoAid</b></font><br/>'
        f'<font color="white" size="12">{escape(title)}</font>',
        ParagraphStyle("hd", parent=_base, leading=20))]], colWidths=[PAGE_W])
    head.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 12),
                              ("TOPPADDING", (0, 0), (-1, -1), 10), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    meta = Table([
        [_p("Prepared for", NOTE), _p(f"{ctx['name']} ({ROLE_LABEL[role]})")],
        [_p("Scope", NOTE), _p(ctx["scope"] + (f" | Disaster: {disaster.disaster_type_name}" if disaster else ""))],
        [_p("Generated", NOTE), _p(now)],
    ], colWidths=[28 * mm, PAGE_W - 28 * mm])
    meta.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.3, LINE),
                              ("TOPPADDING", (0, 0), (-1, -1), 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 3)]))

    buf = io.BytesIO()
    doc = BaseDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                          topMargin=16 * mm, bottomMargin=20 * mm, title=f"GeoAid - {title}", author="GeoAid")
    doc.addPageTemplates([PageTemplate(id="p", frames=[Frame(18 * mm, 20 * mm, PAGE_W, A4[1] - 36 * mm)])])

    class Canvas(_NumberedCanvas):
        footer_text = f"GeoAid | {title} | {ROLE_LABEL[role]}"

    doc.build([head, Spacer(1, 6), meta] + story, canvasmaker=Canvas)
    return buf.getvalue(), title


# ------------------------------------------------------------------- views
def _pdf_cors(resp):
    resp["Access-Control-Allow-Origin"] = "*"
    resp["Access-Control-Expose-Headers"] = "Content-Disposition"
    return resp


@csrf_exempt
def report_pdf(request):
    """
    GET  /api/reports/pdf/?username=...
         -> downloadable PDF built from live data for that user's role.
    POST /api/reports/pdf/   {username, title, content, disaster_type_id}
         -> same PDF, with the title and content typed in the Generate Report
            form printed at the top. (A copy is kept in the Report table.)
    """
    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method not in ("GET", "POST"):
        return _pdf_cors(JsonResponse({"success": False, "message": "GET or POST required."}, status=405))

    written = None
    disaster_id = None
    fname_tag = ""

    if request.method == "POST":
        try:
            data = json.loads(request.body or "{}")
        except ValueError:
            return _pdf_cors(JsonResponse({"success": False, "message": "Invalid JSON."}, status=400))
        username = data.get("username")
        mobile = ""
        title = (data.get("title") or "").strip()
        content = (data.get("content") or "").strip()
        if not title or not content:
            return _pdf_cors(JsonResponse({"success": False,
                "message": "Title and content are required."}, status=400))
        did = str(data.get("disaster_type_id") or "").strip()
        disaster_id = int(did) if did.isdigit() else None
    else:
        username = request.GET.get("username")
        mobile = request.GET.get("mobile_number")
        v = (request.GET.get("disaster_type_id") or "").strip()
        disaster_id = int(v) if v.isdigit() else None

    ctx, err = _resolve_requester(mobile, username)
    if err:
        return _pdf_cors(err)

    if request.method == "POST":
        disaster = DisasterType.objects.filter(pk=disaster_id).first() if disaster_id else None
        Report.objects.create(user=ctx["user"], disaster_type=disaster,
                              title=title[:200], content=content)
        written = {
            "title": title, "content": content,
            "disaster": disaster.disaster_type_name if disaster else "",
        }
        fname_tag = "_" + re.sub(r"[^A-Za-z0-9]+", "_", title)[:40].strip("_")

    pdf, _title = build_report_pdf(ctx, disaster_id, written)
    fname = (f"GeoAid{fname_tag or '_' + ROLE_LABEL[ctx['role']].replace(' ', '_')}"
             f"_Report_{timezone.localdate():%Y%m%d}.pdf")
    resp = HttpResponse(pdf, content_type="application/pdf")
    resp["Content-Disposition"] = f'attachment; filename="{fname}"'
    return _pdf_cors(resp)