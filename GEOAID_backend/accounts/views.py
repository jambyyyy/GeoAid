from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json
import uuid

from .models import Household, FamilyMember


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
            if actual_role == "purok":
                # Best-effort only for now — barangay is stored on the
                # user's First Name field (Django admin > Users), but a
                # Purok President can still log in even if it's not set
                # yet. Dashboard filtering by barangay is not enforced
                # until the frontend is wired up to send it.
                barangay_assignment = _match_barangay(user.first_name)

            response_payload = {
                "success": True,
                "username": user.username,
                "role": actual_role,
            }
            if actual_role == "purok":
                response_payload["barangay"] = barangay_assignment

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


@csrf_exempt
def cswd_dashboard(request):

    data = {
        "total_households": 1254,
        "priority_cases": 346,
        "relief_released": 4562,
        "donations": 85000,

        "relief_distribution": [
            {
                "barangay": "Apao",
                "families": 54,
                "status": "Completed"
            },
            {
                "barangay": "Pala-o",
                "families": 42,
                "status": "Ongoing"
            },
            {
                "barangay": "Tibanga",
                "families": 31,
                "status": "Pending"
            }
        ],

        "priority_beneficiaries": {
            "senior_citizens": 120,
            "pwd": 75,
            "pregnant": 36,
            "children": 98
        },

        "evacuation_centers": [
            {
                "name": "Apao Gymnasium",
                "occupancy": "120 / 200"
            },
            {
                "name": "Hinaplanon Covered Court",
                "occupancy": "95 / 150"
            }
        ]
    }

    return JsonResponse(data)


@csrf_exempt
def purok_dashboard(request):
    """Real household registrations for the Purok President to review.
    Previously returned hardcoded demo families — now pulls from the
    Household/FamilyMember records created via register_resident +
    register_complete.

    TODO: once Purok Presidents are scoped to a specific purok (not just
    barangay) via a staff-user -> purok mapping, filter households_qs by
    that purok too instead of only the optional ?purok= query param below.
    Same for flood_advisory, which needs a real Advisory/Disaster model.
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

    households_qs = (
        Household.objects
        .filter(registration_complete=True)
        .prefetch_related("family_members")
        .order_by("-created_at")
    )
    households_qs = households_qs.filter(barangay__iexact=valid_barangay)
    if purok_filter:
        households_qs = households_qs.filter(purok__iexact=purok_filter)

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
        "purok": purok_filter or "All Puroks",
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
    """Barangay + dwelling type options for HouseholdStep.jsx's
    dropdowns, sourced from the model's choices so there's one place
    to update them instead of duplicating the lists in the frontend."""

    return JsonResponse({
        "barangays": [value for value, _label in Household.BARANGAY_CHOICES],
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

    if household.status != "approved":
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