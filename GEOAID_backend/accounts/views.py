from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.http import JsonResponse, HttpResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
import json
import math
import uuid
from datetime import datetime, timedelta

from .models import (
    Household,
    FamilyMember,
    ReliefItem,
    ReliefInventoryTransaction,
    ReliefDistribution,
    ReliefDistributionItem,
    DisasterType,
    EvacuationCenter,
    Advisory,
    HouseholdNotification,
)


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


def _haversine_km(lat1, lng1, lat2, lng2):
    """Great-circle distance in kilometers between two lat/lng points."""
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _nearest_center_payload(household):
    """Build the resident dashboard's "nearest_center" card from real
    EvacuationCenter rows instead of a hardcoded value.

    Prefers centers with GPS coordinates so a true distance/walk-time can
    be computed against the household's own coordinates; falls back to a
    same-barangay center (no distance shown) when coordinates aren't
    available yet, and finally to any open center. Returns None if there
    are no EvacuationCenter rows at all.
    """
    centers = list(EvacuationCenter.objects.all())
    if not centers:
        return None

    have_household_gps = household.gps_lat is not None and household.gps_lng is not None
    candidates = []
    for c in centers:
        distance_km = None
        if have_household_gps and c.gps_lat is not None and c.gps_lng is not None:
            distance_km = _haversine_km(household.gps_lat, household.gps_lng, c.gps_lat, c.gps_lng)
        candidates.append((c, distance_km))

    # Prefer centers we can actually measure a distance for; among those,
    # nearest first. Otherwise fall back to same-barangay, then anything.
    measurable = [pair for pair in candidates if pair[1] is not None]
    if measurable:
        center, distance_km = min(measurable, key=lambda pair: pair[1])
    else:
        same_barangay = [pair for pair in candidates if pair[0].barangay == household.barangay]
        center, distance_km = (same_barangay or candidates)[0]

    # Average walking speed ~5 km/h.
    walk_minutes = round(distance_km / 5 * 60) if distance_km is not None else None

    return {
        "name": center.name,
        "distance_km": round(distance_km, 1) if distance_km is not None else None,
        "walk_minutes": walk_minutes,
        "status": center.status,
        "occupancy": center.current_occupancy,
        "capacity": center.capacity,
    }


def _active_advisory_for_barangay(barangay):
    """Most recent active Advisory covering a barangay: a barangay-specific
    one takes priority over a city-wide one (blank barangay) if both are
    active, since it's more specific to the resident/purok viewing it."""
    return (
        Advisory.objects.filter(is_active=True, barangay__iexact=barangay).first()
        or Advisory.objects.filter(is_active=True, barangay="").first()
    )


def _match_barangay(value):
    """Match free text against Household.BARANGAY_CHOICES, case-insensitively.
    Returns the canonical choice value (e.g. 'Abuno'), or '' if no match."""

    value = (value or "").strip().lower()
    for choice_value, _label in Household.BARANGAY_CHOICES:
        if choice_value.lower() == value:
            return choice_value
    return ""


def _barangay_for_username(username):
    """Looks up a staff username's Django user and matches their First
    Name (Django admin > Users) against Household.BARANGAY_CHOICES.
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
            "submitted": h.created_at.strftime("%b %d, %Y · %I:%M %p"),
            "status": h.status,
            "members": member_payload,
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
    Relief figures (relief_released, relief_distribution, inventory_units,
    etc.) are computed live from ReliefDistribution/ReliefItem — see
    cswd_relief() and cswd_reports() for the endpoints that manage them."""

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

    barangays = list(
        confirmed_qs.values("barangay")
        .annotate(eligible_households=Count("id"))
        .order_by("-eligible_households")
    )
    relief_distribution = []
    for row in barangays:
        barangay = row["barangay"] or "Unspecified"
        claimed = ReliefDistribution.objects.filter(
            household__in=confirmed_qs,
            barangay=barangay,
            status="claimed",
        ).values("household_id").distinct().count()
        eligible = row["eligible_households"]
        relief_distribution.append({
            "barangay": barangay,
            "families": eligible,
            "claimed_families": claimed,
            "pending_families": max(0, eligible - claimed),
            "status": "Complete" if eligible and claimed >= eligible else "Pending",
        })

    total_claims = ReliefDistribution.objects.filter(
        household__in=confirmed_qs, status="claimed"
    ).count()
    total_units_distributed = ReliefDistributionItem.objects.filter(
        distribution__household__in=confirmed_qs,
        distribution__status="claimed",
    ).aggregate(total=Sum("quantity"))["total"] or 0
    inventory_units = ReliefItem.objects.filter(active=True).aggregate(
        total=Sum("stock_on_hand")
    )["total"] or 0

    claim_household_ids = set(
        ReliefDistribution.objects.filter(
            household__in=confirmed_qs, status="claimed"
        ).values_list("household_id", flat=True)
    )
    beneficiary_checklist = [
        {
            "household_code": h.household_code,
            "household_name": h.full_name,
            "barangay": h.barangay,
            "claimed": h.id in claim_household_ids,
        }
        for h in confirmed_qs.only("id", "household_code", "full_name", "barangay").order_by("barangay", "full_name")
    ]

    data = {
        "total_households": confirmed_qs.count(),
        "priority_cases": priority_cases,
        "relief_released": total_claims,
        "inventory_units": inventory_units,
        "relief_units_distributed": total_units_distributed,
        "relief_distribution": relief_distribution,
        "relief_inventory": _relief_inventory_payload(),
        "beneficiary_checklist": beneficiary_checklist,
        "recent_relief_distributions": _relief_distribution_payload(
            ReliefDistribution.objects
            .select_related("household", "disaster_type")
            .prefetch_related("items__relief_item")
            .filter(status="claimed")
            .order_by("-distributed_at")[:50]
        ),
        "active_disasters": [
            {"id": d.id, "name": d.disaster_type_name}
            for d in DisasterType.objects.filter(status="active").order_by("-start_date", "disaster_type_name")
        ],
        "priority_beneficiaries": priority,
        "evacuation_centers": [
            {
                "id": center.id,
                "name": center.name,
                "barangay": center.barangay,
                "occupancy": center.current_occupancy,
                "capacity": center.capacity,
                "status": center.status,
            }
            for center in EvacuationCenter.objects.all().order_by("barangay", "name")
        ],
        "households": _serialize_households(confirmed_qs),
    }

    return JsonResponse(data)


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
    from .models import EvacuationCenter, Attendance

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

    today = timezone.now().date()
    today_checkins = Attendance.objects.filter(
        evacuation_center=center,
        check_in_time__date=today,
    ).count()

    pending_registrations = Household.objects.filter(
        registration_complete=True,
        barangay__iexact=valid_barangay,
        status="approved",  # approved by Purok President, awaiting this barangay's confirmation
    ).count()

    recent = (
        Attendance.objects.filter(evacuation_center=center)
        .select_related("family_member", "household")
        .order_by("-check_in_time")[:10]
    )
    recent_checkins = [
        {
            "name": a.family_member.full_name,
            "household": f"{a.household.full_name} Household",
            "time": a.check_in_time.strftime("%I:%M %p") if a.check_in_time else "",
        }
        for a in recent
    ]

    # Fuller list for the web dashboard's Attendance tab — same records,
    # more fields, shaped to match dashboard.jsx's attendanceRecords
    # (resident/household/center/checkIn/checkOut/status). "status" uses
    # a hyphen ("checked-out") to match the status-checked-out CSS class
    # already defined in dashboard.css.
    all_records = (
        Attendance.objects.filter(evacuation_center=center)
        .select_related("family_member", "household")
        .order_by("-check_in_time")[:50]
    )
    attendance_records = [
        {
            "resident": a.family_member.full_name,
            "household": f"{a.household.full_name} Household",
            "center": center.name,
            "checkIn": a.check_in_time.strftime("%I:%M %p") if a.check_in_time else "—",
            "checkOut": a.check_out_time.strftime("%I:%M %p") if a.check_out_time else "—",
            "status": "present" if a.attendance_status == "Present" else "checked-out",
        }
        for a in all_records
    ]

    return JsonResponse({
        "staff_name": username_param,
        "evacuation_center": {
            "id": center.id,
            "name": center.name,
            "occupancy": center.current_occupancy,
            "capacity": center.capacity,
            "status": center.status,
        },
        "pending_registrations": pending_registrations,
        "today_checkins": today_checkins,
        "recent_checkins": recent_checkins,
        "attendance_records": attendance_records,
    })


@csrf_exempt
def attendance_scan(request):
    """POST body: { "username": "<staff username>", "qr_code": "<FamilyMember.qr_code>" }

    Looks up the resident by the QR token QRCodeScreen.js renders, finds
    the scanning staff member's assigned evacuation center (same
    barangay-scoping as barangay_dashboard), and toggles the resident
    checked-in / checked-out. Also keeps EvacuationCenter.current_occupancy
    in sync so the dashboard occupancy bar stays accurate."""

    from django.utils import timezone
    from .models import EvacuationCenter, Attendance

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required."}, status=405)

    try:
        data = json.loads(request.body)
        username_param = (data.get("username") or "").strip()
        qr_code = (data.get("qr_code") or "").strip()

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
                "time": existing.check_out_time.strftime("%I:%M %p"),
            })

        record = Attendance.objects.create(
            family_member=member,
            household=member.household,
            evacuation_center=center,
            check_in_time=timezone.now(),
            attendance_status="Present",
        )
        center.current_occupancy += 1
        center.save()

        return JsonResponse({
            "action": "checked_in",
            "member_name": member.full_name,
            "household_name": f"{member.household.full_name} Household",
            "time": record.check_in_time.strftime("%I:%M %p"),
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
            "submitted": h.created_at.strftime("%b %d, %Y · %I:%M %p"),
            "status": h.status,
            "members": member_payload,
        })

    data = {
        "purok": effective_purok or "All Puroks",
        "barangay": valid_barangay,
        "flood_advisory": _active_advisory_for_barangay(valid_barangay) is not None,
        "total_households": households_qs.count(),
        "unregistered_households": Household.objects.filter(
            registration_complete=False,
            barangay__iexact=valid_barangay,
        ).count(),
        "households": households,
    }

    return JsonResponse(data)


@csrf_exempt
def purok_reports(request):
    """Registration reports for a Purok President's Reports tab: weekly
    approvals/rejections (bucketed by when they were reviewed) and new
    registrations/unregistered households (bucketed by when they were
    submitted). Previously PurokDashboard.jsx's Reports tab just showed a
    "not yet available from the dashboard API" placeholder.

    Uses the same barangay/purok scoping as purok_dashboard() above, via
    ?username= (preferred) or ?barangay=/?purok= overrides."""

    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET request required."}, status=405)

    username_param = (request.GET.get("username") or "").strip()
    purok_filter = (request.GET.get("purok") or "").strip()
    barangay_override = (request.GET.get("barangay") or "").strip()

    valid_barangay = _barangay_for_username(username_param) or _match_barangay(barangay_override)
    if not valid_barangay:
        return JsonResponse({
            "purok": purok_filter or "All Puroks",
            "barangay": "",
            "weeks": [],
            "totals": {"approved": 0, "rejected": 0, "pending": 0, "unregistered": 0},
            "message": (
                "Couldn't determine this account's barangay. "
                "Set its First Name in Django admin > Users to its barangay (e.g. 'Tubod')."
            ),
        })

    assigned_purok = _purok_for_username(username_param, valid_barangay)
    effective_purok = assigned_purok or purok_filter

    base_qs = Household.objects.filter(barangay__iexact=valid_barangay)
    if effective_purok:
        base_qs = base_qs.filter(purok__iexact=effective_purok)

    try:
        num_weeks = int(request.GET.get("weeks", 8))
    except ValueError:
        num_weeks = 8
    num_weeks = max(1, min(num_weeks, 26))

    today = timezone.localdate()
    current_week_start = today - timedelta(days=today.weekday())  # Monday

    weeks = []
    for i in range(num_weeks - 1, -1, -1):
        week_start = current_week_start - timedelta(weeks=i)
        week_end = week_start + timedelta(days=6)

        weeks.append({
            "week_start": week_start.isoformat(),
            "week_end": week_end.isoformat(),
            "approved": base_qs.filter(
                status="approved", reviewed_at__date__gte=week_start, reviewed_at__date__lte=week_end
            ).count(),
            "rejected": base_qs.filter(
                status="rejected", reviewed_at__date__gte=week_start, reviewed_at__date__lte=week_end
            ).count(),
            "registered": base_qs.filter(
                registration_complete=True, created_at__date__gte=week_start, created_at__date__lte=week_end
            ).count(),
            "unregistered": base_qs.filter(
                registration_complete=False, created_at__date__gte=week_start, created_at__date__lte=week_end
            ).count(),
        })

    totals = {
        "approved": base_qs.filter(status="approved").count(),
        "rejected": base_qs.filter(status="rejected").count(),
        "pending": base_qs.filter(status="pending", registration_complete=True).count(),
        "unregistered": base_qs.filter(registration_complete=False).count(),
    }

    return JsonResponse({
        "purok": effective_purok or "All Puroks",
        "barangay": valid_barangay,
        "weeks": weeks,
        "totals": totals,
    })


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
        household.reviewed_at = timezone.now()
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
    dropdowns, sourced from the model's choices so there's one place
    to update them instead of duplicating the lists in the frontend."""

    return JsonResponse({
        "barangays": [value for value, _label in Household.BARANGAY_CHOICES],
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

    active_advisory = _active_advisory_for_barangay(household.barangay)

    data = {
        "household_id": household.id,
        "household_name": household_name,
        "unread_alerts": household.notifications.filter(is_read=False).count(),
        "advisory": (
            {"title": active_advisory.title, "body": active_advisory.body}
            if active_advisory else None
        ),
        "nearest_center": _nearest_center_payload(household),
        "members": members,
    }

    return JsonResponse(data)


@csrf_exempt
def mark_resident_alerts_read(request):
    """Marks all of a household's unread HouseholdNotification rows as
    read. Called when the resident taps the bell icon on HomeScreen —
    previously the bell had nothing to actually clear, since
    unread_alerts was a hardcoded 2."""

    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method != "POST":
        return JsonResponse({"message": "POST request required"}, status=405)

    try:
        data = json.loads(request.body)
        mobile_number = (data.get("mobile_number") or "").strip()

        try:
            household = Household.objects.get(mobile_number=mobile_number)
        except Household.DoesNotExist:
            return JsonResponse({"success": False, "message": "Household not found."}, status=404)

        household.notifications.filter(is_read=False).update(is_read=True)

        return JsonResponse({"success": True, "unread_alerts": 0})

    except Exception as e:
        return JsonResponse({"success": False, "message": str(e)}, status=500)


def _require_cswd_username(data):
    """Resolve the staff account from the supplied username and require CSWD
    membership. The existing app uses username-based dashboard calls, so this
    keeps the same contract while preventing arbitrary users from recording
    stock movements."""
    username = (data.get("username") or "").strip()
    if not username:
        return None, JsonResponse({"message": "username is required."}, status=400)

    try:
        user = User.objects.get(username=username, is_active=True)
    except User.DoesNotExist:
        return None, JsonResponse({"message": "CSWD account not found."}, status=403)

    if not user.groups.filter(name__in=["CSWD", "CSWD Personnel", "cswd", "cswd personnel"]).exists():
        return None, JsonResponse({"message": "Only CSWD personnel can record relief operations."}, status=403)

    return user, None


def _require_barangay_username(data):
    """Resolve an active Barangay Staff account and its assigned barangay."""
    username = (data.get("username") or "").strip()
    if not username:
        return None, None, JsonResponse({"message": "username is required."}, status=400)
    try:
        user = User.objects.get(username=username, is_active=True)
    except User.DoesNotExist:
        return None, None, JsonResponse({"message": "Barangay Staff account not found."}, status=403)
    if not user.groups.filter(name__in=["Barangay Staff", "barangay staff", "Barangay", "barangay"]).exists():
        return None, None, JsonResponse({"message": "Only Barangay Staff can claim relief goods."}, status=403)
    barangay = _barangay_for_username(username)
    if not barangay:
        return None, None, JsonResponse({"message": "This account has no assigned barangay."}, status=403)
    return user, barangay, None


@csrf_exempt
def barangay_relief(request):
    """Barangay-scoped relief claiming against the central CSWD/LGU inventory."""
    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method == "GET":
        username = (request.GET.get("username") or "").strip()
        barangay = _barangay_for_username(username)
        if not barangay:
            return JsonResponse({"message": "Couldn't determine this account's barangay."}, status=403)
        confirmed = Household.objects.filter(
            registration_complete=True, status="confirmed", barangay__iexact=barangay
        ).prefetch_related("family_members").order_by("full_name")
        claimed_ids = set(
            ReliefDistribution.objects.filter(
                household__in=confirmed, status="claimed"
            ).values_list("household_id", flat=True)
        )
        households = []
        for h in confirmed:
            households.append({
                "id": h.id,
                "household_code": h.household_code,
                "household_name": h.full_name,
                "barangay": h.barangay,
                "claimed": h.id in claimed_ids,
            })
        distributions = (
            ReliefDistribution.objects.select_related("household", "disaster_type")
            .prefetch_related("items__relief_item")
            .filter(barangay__iexact=barangay, status="claimed")
        )
        return JsonResponse({
            "barangay": barangay,
            "inventory": _relief_inventory_payload(),
            "households": households,
            "disasters": [
                {"id": d.id, "name": d.disaster_type_name}
                for d in DisasterType.objects.filter(status="active").order_by("-start_date", "disaster_type_name")
            ],
            "distributions": _relief_distribution_payload(distributions),
        })

    if request.method != "POST":
        return JsonResponse({"message": "GET or POST request required."}, status=405)

    try:
        data = json.loads(request.body or "{}")
        user, barangay, error = _require_barangay_username(data)
        if error:
            return error
        if (data.get("action") or "").strip().lower() != "claim_relief":
            return JsonResponse({"message": "Unsupported barangay relief action."}, status=400)

        household_code = (data.get("household_code") or "").strip()
        raw_items = data.get("items") or []
        disaster_id = data.get("disaster_id")
        notes = str(data.get("notes") or "").strip()[:255]
        if not household_code or not isinstance(raw_items, list) or not raw_items:
            return JsonResponse({"message": "household_code and at least one relief item are required."}, status=400)

        household = Household.objects.filter(
            household_code=household_code, registration_complete=True, status="confirmed", barangay__iexact=barangay
        ).first()
        if not household:
            return JsonResponse({"message": "Household is not a confirmed beneficiary in your barangay."}, status=400)

        disaster = None
        if disaster_id not in (None, "", 0, "0"):
            try:
                disaster = DisasterType.objects.get(id=int(disaster_id), status="active")
            except (TypeError, ValueError, DisasterType.DoesNotExist):
                return JsonResponse({"message": "Selected disaster is not active or does not exist."}, status=400)

        # One checklist claim per household for each active disaster.
        existing = ReliefDistribution.objects.filter(
            household=household, status="claimed", disaster_type=disaster
        ).exists()
        if existing:
            return JsonResponse({"message": "This household has already claimed relief for the selected disaster."}, status=409)

        requested = {}
        for entry in raw_items:
            try:
                item_id = int(entry.get("item_id"))
                quantity = int(entry.get("quantity"))
            except (TypeError, ValueError, AttributeError):
                return JsonResponse({"message": "Each relief item needs a valid item_id and quantity."}, status=400)
            if quantity <= 0:
                return JsonResponse({"message": "Relief quantities must be greater than zero."}, status=400)
            requested[item_id] = requested.get(item_id, 0) + quantity

        with transaction.atomic():
            locked_items = {
                item.id: item for item in ReliefItem.objects.select_for_update().filter(
                    id__in=requested.keys(), active=True
                )
            }
            missing = [str(item_id) for item_id in requested if item_id not in locked_items]
            if missing:
                return JsonResponse({"message": f"Relief item(s) not found: {', '.join(missing)}"}, status=400)
            for item_id, quantity in requested.items():
                item = locked_items[item_id]
                if item.stock_on_hand < quantity:
                    return JsonResponse({
                        "message": f"Insufficient stock for {item.name}. Available: {item.stock_on_hand} {item.unit}; requested: {quantity}."
                    }, status=409)

            distribution = ReliefDistribution.objects.create(
                household=household, disaster_type=disaster, barangay=household.barangay,
                recorded_by=user.username, notes=notes
            )
            for item_id, quantity in requested.items():
                item = locked_items[item_id]
                item.stock_on_hand -= quantity
                item.save(update_fields=["stock_on_hand", "updated_at"])
                ReliefDistributionItem.objects.create(distribution=distribution, relief_item=item, quantity=quantity)
                ReliefInventoryTransaction.objects.create(
                    item=item, transaction_type=ReliefInventoryTransaction.DISTRIBUTION,
                    quantity=-quantity, balance_after=item.stock_on_hand,
                    reference=f"DIST-{distribution.id}", recorded_by=user.username,
                    notes=f"Barangay claim: {barangay}"
                )

        return JsonResponse({"message": "Relief claim recorded.", "distribution_id": distribution.id}, status=201)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Request body must be valid JSON."}, status=400)
    except Exception as exc:
        return JsonResponse({"message": str(exc)}, status=400)


def _relief_inventory_payload():
    return [
        {
            "id": item.id,
            "name": item.name,
            "unit": item.unit,
            "stock_on_hand": item.stock_on_hand,
            "active": item.active,
        }
        for item in ReliefItem.objects.filter(active=True)
    ]


def _relief_distribution_payload(queryset):
    payload = []
    for distribution in queryset:
        payload.append({
            "id": distribution.id,
            "household_code": distribution.household.household_code,
            "household_name": distribution.household.full_name,
            "barangay": distribution.barangay,
            "status": distribution.status,
            "distributed_at": distribution.distributed_at.isoformat(),
            "recorded_by": distribution.recorded_by,
            "notes": distribution.notes,
            "disaster": (
                distribution.disaster_type.disaster_type_name
                if distribution.disaster_type else None
            ),
            "items": [
                {
                    "id": line.relief_item_id,
                    "name": line.relief_item.name,
                    "unit": line.relief_item.unit,
                    "quantity": line.quantity,
                }
                for line in distribution.items.select_related("relief_item").all()
            ],
        })
    return payload



@csrf_exempt
def cswd_reports(request):
    """CSWD relief reporting endpoint. All figures are derived from persisted
    relief distributions, distribution lines, inventory transactions and
    confirmed household records. Supports JSON summaries and CSV export."""
    if request.method == "OPTIONS":
        return _cors_preflight()
    if request.method != "GET":
        return JsonResponse({"message": "GET request required."}, status=405)

    def clean_date(value):
        value = (value or "").strip()
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            return "invalid"

    start_date = clean_date(request.GET.get("start_date"))
    end_date = clean_date(request.GET.get("end_date"))
    if start_date == "invalid" or end_date == "invalid":
        return JsonResponse({"message": "Dates must use YYYY-MM-DD."}, status=400)
    if start_date and end_date and start_date > end_date:
        return JsonResponse({"message": "start_date cannot be later than end_date."}, status=400)

    barangay = (request.GET.get("barangay") or "").strip()
    disaster_id = (request.GET.get("disaster_id") or "").strip()
    if disaster_id:
        try:
            int(disaster_id)
        except ValueError:
            return JsonResponse({"message": "disaster_id must be a valid integer."}, status=400)

    qs = ReliefDistribution.objects.filter(status="claimed").select_related("household", "disaster_type").prefetch_related("items__relief_item")
    if start_date:
        qs = qs.filter(distributed_at__date__gte=start_date)
    if end_date:
        qs = qs.filter(distributed_at__date__lte=end_date)
    if barangay:
        qs = qs.filter(barangay__iexact=barangay)
    if disaster_id:
        qs = qs.filter(disaster_type_id=int(disaster_id))

    distribution_rows = []
    item_summary = {}
    barangay_summary = {}
    total_units = 0
    for distribution in qs.order_by("-distributed_at"):
        lines = []
        for line in distribution.items.all():
            qty = int(line.quantity)
            total_units += qty
            item_key = line.relief_item.name
            item_entry = item_summary.setdefault(item_key, {"name": item_key, "unit": line.relief_item.unit, "quantity": 0, "distributions": 0})
            item_entry["quantity"] += qty
            item_entry["distributions"] += 1
            lines.append({"name": line.relief_item.name, "unit": line.relief_item.unit, "quantity": qty})

        b = distribution.barangay or "Unspecified"
        b_entry = barangay_summary.setdefault(b, {"barangay": b, "claims": 0, "units": 0, "households": set()})
        b_entry["claims"] += 1
        b_entry["units"] += sum(line["quantity"] for line in lines)
        b_entry["households"].add(distribution.household_id)

        distribution_rows.append({
            "id": distribution.id,
            "household_code": distribution.household.household_code,
            "household_name": distribution.household.full_name,
            "barangay": b,
            "disaster": distribution.disaster_type.disaster_type_name if distribution.disaster_type else None,
            "distributed_at": distribution.distributed_at.isoformat(),
            "recorded_by": distribution.recorded_by,
            "notes": distribution.notes,
            "items": lines,
            "total_units": sum(line["quantity"] for line in lines),
        })

    barangay_rows = [
        {"barangay": v["barangay"], "claims": v["claims"], "households": len(v["households"]), "units": v["units"]}
        for _, v in sorted(barangay_summary.items(), key=lambda pair: (-pair[1]["claims"], pair[0]))
    ]
    item_rows = sorted(item_summary.values(), key=lambda row: (-row["quantity"], row["name"]))

    data = {
        "filters": {"start_date": request.GET.get("start_date") or "", "end_date": request.GET.get("end_date") or "", "barangay": barangay, "disaster_id": disaster_id},
        "summary": {
            "claims": len(distribution_rows),
            "unique_households": len({row["household_code"] for row in distribution_rows}),
            "units_distributed": total_units,
        },
        "barangays": barangay_rows,
        "items": item_rows,
        "distributions": distribution_rows,
        "available_inventory": _relief_inventory_payload(),
        "disasters": [{"id": d.id, "name": d.disaster_type_name} for d in DisasterType.objects.all().order_by("-start_date", "disaster_type_name")],
        "barangay_options": [row for row in Household.objects.filter(registration_complete=True, status="confirmed").values_list("barangay", flat=True).distinct().order_by("barangay") if row],
    }

    if request.GET.get("format", "json").lower() == "csv":
        import csv
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="geoaid_cswd_relief_report.csv"'
        writer = csv.writer(response)
        writer.writerow(["Distribution ID", "Household Code", "Household Name", "Barangay", "Disaster", "Distributed At", "Recorded By", "Relief Item", "Unit", "Quantity", "Notes"])
        for row in distribution_rows:
            for item in row["items"]:
                writer.writerow([row["id"], row["household_code"], row["household_name"], row["barangay"], row["disaster"] or "", row["distributed_at"], row["recorded_by"], item["name"], item["unit"], item["quantity"], row["notes"]])
        return response

    return JsonResponse(data)


@csrf_exempt
def cswd_relief(request):
    """Read the complete relief inventory/checklist and record a household
    distribution. All figures are database-backed; no demo inventory is used."""
    if request.method == "OPTIONS":
        return _cors_preflight()

    if request.method == "GET":
        distributions = (
            ReliefDistribution.objects
            .select_related("household", "disaster_type")
            .prefetch_related("items__relief_item")
            .all()
        )
        return JsonResponse({
            "inventory": _relief_inventory_payload(),
            "distributions": _relief_distribution_payload(distributions),
            "confirmed_households": _serialize_households(
                Household.objects.filter(
                    registration_complete=True, status="confirmed"
                ).prefetch_related("family_members").order_by("full_name")
            ),
            "disasters": [
                {"id": d.id, "name": d.disaster_type_name, "status": d.status}
                for d in DisasterType.objects.filter(status="active").order_by("-start_date", "disaster_type_name")
            ],
        })

    if request.method != "POST":
        return JsonResponse({"message": "GET or POST request required."}, status=405)

    try:
        data = json.loads(request.body or "{}")
        user, error = _require_cswd_username(data)
        if error:
            return error

        action = (data.get("action") or "").strip().lower()

        if action == "create_item":
            name = (data.get("name") or "").strip()
            unit = (data.get("unit") or "").strip()
            initial_stock = data.get("initial_stock", 0)

            if not name or not unit:
                return JsonResponse({"message": "name and unit are required."}, status=400)
            try:
                initial_stock = int(initial_stock)
            except (TypeError, ValueError):
                return JsonResponse({"message": "initial_stock must be a whole number."}, status=400)
            if initial_stock < 0:
                return JsonResponse({"message": "initial_stock cannot be negative."}, status=400)

            with transaction.atomic():
                item = ReliefItem.objects.create(
                    name=name, unit=unit, stock_on_hand=initial_stock
                )
                if initial_stock:
                    ReliefInventoryTransaction.objects.create(
                        item=item,
                        transaction_type=ReliefInventoryTransaction.RECEIPT,
                        quantity=initial_stock,
                        balance_after=initial_stock,
                        recorded_by=user.username,
                        notes="Initial stock",
                    )

            return JsonResponse({
                "message": "Relief item created.",
                "item": {
                    "id": item.id,
                    "name": item.name,
                    "unit": item.unit,
                    "stock_on_hand": item.stock_on_hand,
                    "active": item.active,
                },
            }, status=201)

        if action == "receive_stock":
            try:
                item_id = int(data.get("item_id"))
                quantity = int(data.get("quantity"))
            except (TypeError, ValueError):
                return JsonResponse({"message": "item_id and quantity must be whole numbers."}, status=400)

            if quantity <= 0:
                return JsonResponse({"message": "quantity must be greater than zero."}, status=400)

            with transaction.atomic():
                item = ReliefItem.objects.select_for_update().get(id=item_id, active=True)
                item.stock_on_hand += quantity
                item.save(update_fields=["stock_on_hand", "updated_at"])
                ReliefInventoryTransaction.objects.create(
                    item=item,
                    transaction_type=ReliefInventoryTransaction.RECEIPT,
                    quantity=quantity,
                    balance_after=item.stock_on_hand,
                    reference=str(data.get("reference") or "").strip()[:100],
                    notes=str(data.get("notes") or "").strip()[:255],
                    recorded_by=user.username,
                )

            return JsonResponse({"message": "Stock received.", "stock_on_hand": item.stock_on_hand})

        if action == "record_distribution":
            household_code = (data.get("household_code") or "").strip()
            raw_items = data.get("items") or []
            notes = str(data.get("notes") or "").strip()[:255]
            disaster_id = data.get("disaster_id")

            if not household_code or not isinstance(raw_items, list) or not raw_items:
                return JsonResponse({
                    "message": "household_code and at least one relief item are required."
                }, status=400)

            try:
                household = Household.objects.get(
                    household_code=household_code,
                    registration_complete=True,
                    status="confirmed",
                )
            except Household.DoesNotExist:
                return JsonResponse({
                    "message": "Only confirmed households can receive relief goods."
                }, status=400)

            disaster = None
            if disaster_id not in (None, "", 0, "0"):
                try:
                    disaster = DisasterType.objects.get(id=int(disaster_id), status="active")
                except (TypeError, ValueError, DisasterType.DoesNotExist):
                    return JsonResponse({"message": "Selected disaster is not active or does not exist."}, status=400)

            # Aggregate repeated item IDs before locking stock rows.
            requested = {}
            for entry in raw_items:
                try:
                    item_id = int(entry.get("item_id"))
                    quantity = int(entry.get("quantity"))
                except (TypeError, ValueError, AttributeError):
                    return JsonResponse({"message": "Each relief item needs a valid item_id and quantity."}, status=400)
                if quantity <= 0:
                    return JsonResponse({"message": "Relief quantities must be greater than zero."}, status=400)
                requested[item_id] = requested.get(item_id, 0) + quantity

            with transaction.atomic():
                locked_items = {
                    item.id: item
                    for item in ReliefItem.objects.select_for_update().filter(
                        id__in=requested.keys(), active=True
                    )
                }

                missing = [str(item_id) for item_id in requested if item_id not in locked_items]
                if missing:
                    return JsonResponse({
                        "message": f"Relief item(s) not found: {', '.join(missing)}"
                    }, status=400)

                for item_id, quantity in requested.items():
                    item = locked_items[item_id]
                    if item.stock_on_hand < quantity:
                        return JsonResponse({
                            "message": (
                                f"Insufficient stock for {item.name}. "
                                f"Available: {item.stock_on_hand} {item.unit}; requested: {quantity}."
                            )
                        }, status=409)

                distribution = ReliefDistribution.objects.create(
                    household=household,
                    disaster_type=disaster,
                    barangay=household.barangay,
                    recorded_by=user.username,
                    notes=notes,
                )

                for item_id, quantity in requested.items():
                    item = locked_items[item_id]
                    item.stock_on_hand -= quantity
                    item.save(update_fields=["stock_on_hand", "updated_at"])
                    ReliefDistributionItem.objects.create(
                        distribution=distribution,
                        relief_item=item,
                        quantity=quantity,
                    )
                    ReliefInventoryTransaction.objects.create(
                        item=item,
                        transaction_type=ReliefInventoryTransaction.DISTRIBUTION,
                        quantity=-quantity,
                        balance_after=item.stock_on_hand,
                        reference=f"DIST-{distribution.id}",
                        recorded_by=user.username,
                    )

            return JsonResponse({
                "message": "Relief distribution recorded.",
                "distribution_id": distribution.id,
            }, status=201)

        return JsonResponse({"message": "Unsupported relief action."}, status=400)

    except ReliefItem.DoesNotExist:
        return JsonResponse({"message": "Relief item not found."}, status=404)
    except ReliefItem.MultipleObjectsReturned:
        return JsonResponse({"message": "A relief item with that name already exists."}, status=409)
    except json.JSONDecodeError:
        return JsonResponse({"message": "Invalid JSON request."}, status=400)
    except Exception as e:
        return JsonResponse({"message": str(e)}, status=500)
