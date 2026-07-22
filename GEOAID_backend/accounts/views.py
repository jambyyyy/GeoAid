from django.contrib.auth import authenticate
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import json


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