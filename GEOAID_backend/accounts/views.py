from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q, ProtectedError, RestrictedError
from django.http import JsonResponse
from django.utils import timezone
from django.utils.dateparse import parse_date
from django.views.decorators.csrf import csrf_exempt
from zoneinfo import ZoneInfo
import json
import uuid

from .models import Household, FamilyMember, EvacuationCenter, Attendance, Donation, Barangay, EvacuationRoute
from . import routing
import re

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


@csrf_exempt
def cswd_dashboard(request):
    """City-wide CSWD view of every household that has cleared the full
    Purok President -> Barangay Staff review chain (status='confirmed').
    Relief distribution doesn't have a backing model yet, so that stays
    a clearly-labeled placeholder until that feature exists. Donations
    are now backed by the Donation model (CSWD logs each drop-off
    themselves from the Donations tab — see cswd_add_donation below)."""

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

    relief_distribution = [
        {
            "barangay": row["barangay"] or "Unspecified",
            "families": row["total"],
            # TODO: replace with a real ReliefDistribution model; for now
            # every confirmed household is just "Registered" and awaiting
            # an actual relief-goods disbursement record.
            "status": "Registered",
        }
        for row in confirmed_qs.values("barangay").annotate(total=Count("id")).order_by("-total")
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

    data = {
        "total_households": confirmed_qs.count(),
        "priority_cases": priority_cases,
        # TODO: relief_released needs a real ReliefDistribution model —
        # no such data exists yet.
        "relief_released": 0,
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

        "households": _serialize_households(confirmed_qs),
    }

    return JsonResponse(data)


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

    for route in EvacuationRoute.objects.select_related("evacuation_center"):
        center = route.evacuation_center
        barangay = barangays.get((route.start_location or "").strip().lower())
        if barangay is None:
            continue  # start_location doesn't match a known barangay -- can't place it on the graph

        b_node, c_node = f"b{barangay.id}", f"c{center.id}"
        if b_node not in node_info:
            node_info[b_node] = {"name": barangay.barangay_name, "lat": barangay.latitude, "lng": barangay.longitude, "type": "barangay"}
        if c_node not in node_info:
            lat = center.latitude if center.latitude is not None else barangay.latitude
            lng = center.longitude if center.longitude is not None else barangay.longitude
            node_info[c_node] = {"name": center.name, "lat": lat, "lng": lng, "type": "center"}
            center_objs[c_node] = center

        km = _parse_route_distance_km(route.route_distance)
        if km is None:
            a, b = node_info[b_node], node_info[c_node]
            if None in (a["lat"], a["lng"], b["lat"], b["lng"]):
                continue  # no distance on the route and no coordinates to estimate one
            km = routing.haversine_km(a["lat"], a["lng"], b["lat"], b["lng"])

        risk = {c_node: routing.RISK_MULTIPLIER[route.route_status]} if avoid_risk and route.route_status in routing.RISK_MULTIPLIER else None
        graph.add_edge(b_node, c_node, km, route.road_condition, segment_id=route.id, risk=risk)

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
    node connected by straight-line connectors to its nearest barangay
    nodes (routing.attach_virtual_start), then Dijkstra runs once from
    there over the real (weighted-by-condition/risk) pinned routes.

    Returns (recommended, alternatives, message) — recommended/alternatives
    are _route_result_json() dicts (or None/[] if nothing is reachable).
    """
    graph, node_info, center_objs = _build_route_graph(avoid_risk=avoid_risk)
    if not center_objs:
        return None, [], (
            "No routes have been pinned yet. Pin a route from a barangay to an "
            "evacuation center first (Disaster Location Info > Evacuation Routes)."
        )

    barangay_nodes = [
        n for n, info in node_info.items()
        if info["type"] == "barangay" and info["lat"] is not None and info["lng"] is not None
    ]
    if not barangay_nodes:
        return None, [], "No barangays have coordinates set yet, so a route can't be drawn."

    node_coords = {n: (node_info[n]["lat"], node_info[n]["lng"]) for n in barangay_nodes}
    source = "resident_start"
    routing.attach_virtual_start(graph, source, lat, lng, node_coords, barangay_nodes, k=2)
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
            "message": "No routes have been pinned yet. Pin a route from a barangay to an evacuation "
                       "center first (Disaster Location Info > Evacuation Routes).",
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

        if h.is_four_ps:
            flags.add("4Ps")

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