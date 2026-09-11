from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db.models import Count, Q
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt
from zoneinfo import ZoneInfo
import json
import uuid

from .models import Household, FamilyMember, EvacuationCenter, Attendance, Donation, Barangay, ReliefDistribution

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

    # Same one-query-then-group approach for relief distribution records,
    # replacing the old hardcoded "every household is Registered" mock.
    # Ordered -distributed_at (see ReliefDistribution.Meta) so [0] below
    # is always the most recent release for that household.
    relief_by_household = {}
    for r in (
        ReliefDistribution.objects
        .filter(household_id__in=household_ids)
        .select_related("disaster_type")
    ):
        relief_by_household.setdefault(r.household_id, []).append(r)

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

        if h.is_four_ps:
            flags.add("4Ps")

        # Priority classification from vulnerability flags. This is a
        # starting point, not a formula from a fixed spec — PWD/Pregnant
        # count double since those usually need more direct assistance
        # than a 4Ps household ID alone. Adjust the weights below if you
        # want a different priority formula.
        weight = {"PWD": 2, "Pregnant": 2, "Elderly": 1, "Child<5": 1, "4Ps": 1}
        priority_score = sum(weight.get(f, 0) for f in flags)
        if priority_score >= 3:
            priority_level = "High"
        elif priority_score >= 1:
            priority_level = "Medium"
        else:
            priority_level = "Low"

        present_records = present_by_household.get(h.id, [])
        checked_in = len(present_records) > 0
        # Assumes one evacuation center per check-in event (a household
        # doesn't split across centers) — takes the first record's center.
        checked_in_center = present_records[0].evacuation_center.name if present_records else None
        checked_in_members = [a.family_member.full_name for a in present_records]

        relief_records = relief_by_household.get(h.id, [])
        latest_relief = relief_records[0] if relief_records else None

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
            "relief_status": "Relief Given" if relief_records else "Registered",
            "relief_count": len(relief_records),
            "relief_last_goods": latest_relief.goods_type if latest_relief else None,
            "relief_last_quantity": latest_relief.quantity if latest_relief else None,
            "relief_last_date": _format_ph(latest_relief.distributed_at, "%b %d, %Y") if latest_relief else None,
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


def _serialize_reports(limit=20):
    """Most recent Report rows, shaped to match what the CSWD/Barangay/
    DRRM Reports tabs already render (title/type/date), plus the full
    content and who generated it. Shared across dashboards the same way
    _serialize_households is — every role sees the same underlying
    report list rather than a role-specific copy, since reports aren't
    scoped to a barangay or role in the ERD (Table 3.24)."""

    from .models import Report

    return [
        {
            "id": r.id,
            "title": r.title,
            "type": r.report_type,
            "content": r.content,
            "date": _format_ph(r.created_at, "%b %d, %Y"),
            "disaster_type": r.disaster_type.disaster_type_name if r.disaster_type else "",
            "generated_by": r.generated_by.username if r.generated_by else "",
        }
        for r in Report.objects.select_related("disaster_type", "generated_by").order_by("-created_at")[:limit]
    ]


@csrf_exempt
def generate_report(request):
    """Lets any staff dashboard (CSWD, Barangay, DRRM) create a Report
    row from its Reports tab's "Generate Report" form. Not scoped to a
    role or barangay — matches the ERD, where a report just records
    which user generated it (generated_by), not which role."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    from .models import Report, DisasterType

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    report_type = (payload.get("report_type") or "").strip()
    title = (payload.get("title") or "").strip()
    content = (payload.get("content") or "").strip()

    valid_types = dict(Report.REPORT_TYPE_CHOICES)
    if report_type not in valid_types:
        return JsonResponse({"message": f"report_type must be one of: {', '.join(valid_types)}."}, status=400)
    if not title or not content:
        return JsonResponse({"message": "Title and content are required."}, status=400)

    disaster_type = None
    disaster_type_id = payload.get("disaster_type_id")
    if disaster_type_id:
        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first()
        if not disaster_type:
            return JsonResponse({"message": "Selected disaster type was not found."}, status=400)

    username = (payload.get("username") or "").strip()
    generated_by = User.objects.filter(username=username).first() if username else None

    report = Report.objects.create(
        report_type=report_type,
        title=title,
        content=content,
        disaster_type=disaster_type,
        generated_by=generated_by,
    )

    return JsonResponse({
        "success": True,
        "report": {
            "id": report.id,
            "title": report.title,
            "type": report.report_type,
            "content": report.content,
            "date": _format_ph(report.created_at, "%b %d, %Y"),
            "disaster_type": disaster_type.disaster_type_name if disaster_type else "",
            "generated_by": generated_by.username if generated_by else "",
        },
    })


@csrf_exempt
def cswd_dashboard(request):
    """City-wide CSWD view of every household that has cleared the full
    Purok President -> Barangay Staff review chain (status='confirmed').
    Relief distribution is backed by the ReliefDistribution model (see
    cswd_record_relief below for how CSWD logs a release). Donations are
    backed by the Donation model (CSWD logs each drop-off themselves from
    the Donations tab — see cswd_add_donation below)."""

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
        | Q(is_four_ps=True)
    ).distinct().count()

    # Serialized once here (instead of again at the bottom of this
    # function) so the per-barangay relief summary below and the
    # per-household "households" list in the response both come from
    # the exact same relief data — no risk of the two disagreeing.
    serialized_households = _serialize_households(confirmed_qs)

    relief_by_barangay = {}
    for h in serialized_households:
        entry = relief_by_barangay.setdefault(
            h["barangay"], {"barangay": h["barangay"], "families": 0, "given": 0}
        )
        entry["families"] += 1
        if h["relief_status"] == "Relief Given":
            entry["given"] += 1

    relief_distribution = []
    for entry in sorted(relief_by_barangay.values(), key=lambda e: -e["families"]):
        if entry["given"] == 0:
            status = "Registered"
        elif entry["given"] == entry["families"]:
            status = "Relief Given"
        else:
            status = "Partial"
        relief_distribution.append({
            "barangay": entry["barangay"] or "Unspecified",
            "families": entry["families"],
            "status": status,
        })

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

    data = {
        "total_households": confirmed_qs.count(),
        "priority_cases": priority_cases,
        "relief_released": ReliefDistribution.objects.filter(household__in=confirmed_qs).count(),
        "donations": donations_qs.count(),

        "relief_distribution": relief_distribution,
        "priority_beneficiaries": priority,
        "donation_records": donation_records,
        "disaster_types": disaster_types,
        # Sourced from the Barangay table (Django admin > Barangays), not
        # hardcoded — lets the "All Barangays" filter on the CSWD panel
        # stay in sync with whatever barangays actually exist.
        "barangays": list(Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)),

        "evacuation_centers": [
            {
                "id": c.id,
                "name": c.name,
                "barangay": c.barangay,
                "occupancy": f"{c.current_occupancy} / {c.capacity}",
                "occupancy_pct": round((c.current_occupancy / c.capacity) * 100) if c.capacity else 0,
                "status": c.status,
            }
            for c in EvacuationCenter.objects.all().order_by("barangay", "name")
        ],

        "households": serialized_households,
        "reports": _serialize_reports(),
    }

    return JsonResponse(data)


@csrf_exempt
def cswd_record_relief(request):
    """Lets CSWD staff log a relief release for a specific household from
    the Relief Distribution tab. This is the write side of the
    beneficiary checklist Objective 4 asks for — each call creates one
    ReliefDistribution row, so a household's relief_status flips from
    "Registered" to "Relief Given" the next time the dashboard is
    fetched (see _serialize_households above)."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON body."}, status=400)

    household_code = (payload.get("household_code") or "").strip()
    goods_type = (payload.get("goods_type") or "").strip()
    quantity = payload.get("quantity")

    if not household_code or not goods_type:
        return JsonResponse({"message": "Household and goods type are required."}, status=400)

    household = Household.objects.filter(household_code=household_code).first()
    if not household:
        return JsonResponse({"message": "Household not found."}, status=404)

    try:
        quantity = int(quantity)
        if quantity < 0:
            raise ValueError
    except (TypeError, ValueError):
        return JsonResponse({"message": "Quantity must be a non-negative number."}, status=400)

    disaster_type = None
    disaster_type_id = payload.get("disaster_type_id")
    if disaster_type_id:
        from .models import DisasterType
        disaster_type = DisasterType.objects.filter(id=disaster_type_id).first()
        if not disaster_type:
            return JsonResponse({"message": "Selected disaster type was not found."}, status=400)

    relief = ReliefDistribution.objects.create(
        household=household,
        goods_type=goods_type,
        quantity=quantity,
        disaster_type=disaster_type,
        distributed_by=(payload.get("username") or "").strip(),
        remarks=(payload.get("remarks") or "").strip(),
    )

    return JsonResponse({
        "success": True,
        "relief": {
            "id": relief.id,
            "household_code": household.household_code,
            "goods_type": relief.goods_type,
            "quantity": relief.quantity,
            "distributed_at": relief.distributed_at.strftime("%b %d, %Y"),
            "disaster_type": disaster_type.disaster_type_name if disaster_type else "",
        },
    })


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

    if not donor_name or not goods_type:
        return JsonResponse({"message": "Donor name and goods type are required."}, status=400)

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

    donation = Donation.objects.create(
        donor_name=donor_name,
        contact_num=(payload.get("contact_num") or "").strip(),
        goods_type=goods_type,
        quantity=quantity,
        donation_date=donation_date,
        status=status,
        disaster_type=disaster_type,
    )

    return JsonResponse({
        "success": True,
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

    from .models import DisasterType

    data = {
        "total_households": confirmed_qs.count(),
        "pending_review": all_qs.filter(status="pending").count(),
        "awaiting_barangay_confirmation": all_qs.filter(status="approved").count(),
        "rejected": all_qs.filter(status="rejected").count(),
        "priority_beneficiaries": _priority_beneficiary_counts(confirmed_qs),
        "barangay_breakdown": barangay_breakdown,
        "households": _serialize_households(confirmed_qs),
        "reports": _serialize_reports(),
        "disaster_types": [
            {"id": dt.id, "name": dt.disaster_type_name, "status": dt.status}
            for dt in DisasterType.objects.order_by("-start_date", "disaster_type_name")
        ],
    }

    return JsonResponse(data)


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

    from .models import DisasterType

    data = {
        "barangay": valid_barangay,
        "total_households": households_qs.filter(status="confirmed").count(),
        "pending_confirmation": households_qs.filter(status="approved").count(),
        "rejected_households": households_qs.filter(status="rejected").count(),
        "unregistered_households": Household.objects.filter(
            registration_complete=False,
            barangay__iexact=valid_barangay,
        ).count(),
        "households": _serialize_households(households_qs),
        "disaster_types": [
            {"id": dt.id, "name": dt.disaster_type_name, "status": dt.status}
            for dt in DisasterType.objects.order_by("-start_date", "disaster_type_name")
        ],
        "reports": _serialize_reports(),
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
    evacuation_centers = [
        {
            "id": c.id,
            "name": c.name,
            "barangay": c.barangay,
            "occupancy": c.current_occupancy,
            "capacity": c.capacity,
            "status": c.status,
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
        "households": _serialize_households(households_qs),
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
    in Step 1 via register_resident) and fills in address/dwelling/4Ps
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
        household.is_four_ps = bool(data.get("is_four_ps"))
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
        if household.is_four_ps:
            flags.append("4Ps")

        members.append({
            "id": member.id,
            "name": member.full_name,
            "role": "Head of Household" if member.relation == "Head" else member.relation,
            "flags": flags,
            # Sent as "qr_token" to match what QRCodeScreen.js expects.
            "qr_token": member.qr_code,
        })

    household_name = f"{household.full_name.split(' ')[-1]} Household" if household.full_name else "Household"

    data = {
        "household_id": household.id,
        "household_name": household_name,
        "unread_alerts": 2,
        # TODO: replace with a real Advisory/Disaster model + geo lookup.
        "advisory": {
            "title": "Flood Advisory — Tibanga",
            "body": "PAGASA: Heavy rainfall expected. Prepare go-bag. Issued 7:45 AM",
        },
        # TODO: replace with a real EvacuationCenter model + geo lookup.
        "nearest_center": {
            "name": "Tibanga Gymnasium",
            "distance_km": 0.8,
            "walk_minutes": 10,
            "status": "open",
            "occupancy": 87,
            "capacity": 300,
        },
        "members": members,
    }

    return JsonResponse(data)