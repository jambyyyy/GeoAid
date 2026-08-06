from django.contrib.auth import authenticate
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json

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

            return JsonResponse({
                "success": True,
                "username": user.username,
                "role": actual_role
            })

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

    data = {
        "purok": "Purok 3",
        "barangay": "Tibanga, Iligan City",
        "flood_advisory": True,
        "total_households": 147,
        "unregistered_households": 12,

        # Household registrations submitted by residents of this Purok,
        # awaiting Purok President verification before being forwarded
        # to Barangay Staff for final confirmation.
        "households": [
            {
                "id": "GAID-2025-08-1053",
                "family_name": "Bautista",
                "flags": ["PWD", "4Ps"],
                "address": "12 Mabuhay St., Tibanga",
                "gps_lat": 8.2281,
                "gps_lng": 124.2441,
                "submitted": "Jul 21, 2025 · 8:14 AM",
                "status": "pending",
                "members": [
                    {"name": "Elena Bautista", "relation": "Head", "age": 38},
                    {"name": "Ramon Bautista", "relation": "Spouse", "age": 42, "tag": "PWD - mobility impairment"},
                    {"name": "Kyla Bautista", "relation": "Child", "age": 14},
                    {"name": "Lito Bautista", "relation": "Child", "age": 10},
                    {"name": "Nena Cruz", "relation": "Parent", "age": 68},
                ],
            },
            {
                "id": "GAID-2025-08-1054",
                "family_name": "Fernandez",
                "flags": ["Pregnant"],
                "address": "7 Maliksi Ave., Tibanga",
                "gps_lat": 8.2274,
                "gps_lng": 124.2453,
                "submitted": "Jul 21, 2025 · 8:52 AM",
                "status": "pending",
                "members": [
                    {"name": "Jose Fernandez", "relation": "Head", "age": 31},
                    {"name": "Marites Fernandez", "relation": "Spouse", "age": 29, "tag": "Pregnant - 7 months"},
                    {"name": "Miko Fernandez", "relation": "Child", "age": 3},
                ],
            },
            {
                "id": "GAID-2025-08-1055",
                "family_name": "Ocampo",
                "flags": ["Elderly", "4Ps", "Child<5"],
                "address": "34 Rizal St., Tibanga",
                "gps_lat": 8.2290,
                "gps_lng": 124.2438,
                "submitted": "Jul 20, 2025 · 6:03 PM",
                "status": "pending",
                "members": [
                    {"name": "Vicente Ocampo", "relation": "Head", "age": 71, "tag": "Elderly"},
                    {"name": "Rosa Ocampo", "relation": "Spouse", "age": 67, "tag": "Elderly"},
                    {"name": "Anna Ocampo", "relation": "Daughter", "age": 33},
                    {"name": "Mark Ocampo", "relation": "Son-in-law", "age": 35},
                    {"name": "Zoe Ocampo", "relation": "Grandchild", "age": 4, "tag": "Child < 5"},
                    {"name": "Ben Ocampo", "relation": "Grandchild", "age": 2, "tag": "Child < 5"},
                ],
            },
            {
                "id": "GAID-2025-08-1041",
                "family_name": "Reyes",
                "flags": ["4Ps"],
                "address": "9 Bonifacio St., Tibanga",
                "gps_lat": 8.2266,
                "gps_lng": 124.2447,
                "submitted": "Jul 19, 2025 · 9:10 AM",
                "status": "approved",
                "members": [
                    {"name": "Carlo Reyes", "relation": "Head", "age": 40},
                    {"name": "Divina Reyes", "relation": "Spouse", "age": 37},
                    {"name": "Pia Reyes", "relation": "Child", "age": 9},
                ],
            },
            {
                "id": "GAID-2025-08-1042",
                "family_name": "Torres",
                "flags": [],
                "address": "21 Aguinaldo St., Tibanga",
                "gps_lat": 8.2258,
                "gps_lng": 124.2429,
                "submitted": "Jul 18, 2025 · 3:47 PM",
                "status": "approved",
                "members": [
                    {"name": "Samuel Torres", "relation": "Head", "age": 29},
                    {"name": "Iris Torres", "relation": "Spouse", "age": 27},
                ],
            },
            {
                "id": "GAID-2025-08-1043",
                "family_name": "Santos",
                "flags": ["Elderly"],
                "address": "5 Luna St., Tibanga",
                "gps_lat": 8.2295,
                "gps_lng": 124.2460,
                "submitted": "Jul 18, 2025 · 10:02 AM",
                "status": "approved",
                "members": [
                    {"name": "Perla Santos", "relation": "Head", "age": 74, "tag": "Elderly"},
                    {"name": "Noel Santos", "relation": "Son", "age": 41},
                ],
            },
            {
                "id": "GAID-2025-08-1044",
                "family_name": "Villa",
                "flags": ["4Ps", "Child<5"],
                "address": "18 Del Pilar St., Tibanga",
                "gps_lat": 8.2272,
                "gps_lng": 124.2419,
                "submitted": "Jul 17, 2025 · 4:30 PM",
                "status": "approved",
                "members": [
                    {"name": "Arnel Villa", "relation": "Head", "age": 33},
                    {"name": "Grace Villa", "relation": "Spouse", "age": 30},
                    {"name": "Tim Villa", "relation": "Child", "age": 1, "tag": "Child < 5"},
                ],
            },
            {
                "id": "GAID-2025-08-1045",
                "family_name": "Rosales",
                "flags": [],
                "address": "2 Quezon St., Tibanga",
                "gps_lat": 8.2249,
                "gps_lng": 124.2452,
                "submitted": "Jul 16, 2025 · 1:18 PM",
                "status": "approved",
                "members": [
                    {"name": "Danilo Rosales", "relation": "Head", "age": 52},
                    {"name": "Fe Rosales", "relation": "Spouse", "age": 49},
                ],
            },
        ],
    }

    return JsonResponse(data)

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
            "name": member.full_name,
            "role": "Head of Household" if member.relation == "Head" else member.relation,
            "flags": flags,
        })

    household_name = f"{household.full_name.split(' ')[-1]} Household" if household.full_name else "Household"

    data = {
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