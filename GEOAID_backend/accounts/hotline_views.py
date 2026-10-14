"""DRRM emergency hotline: public read, authenticated DRRM-only write."""
import hashlib
import json
import re

from django.contrib.auth import authenticate
from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import EmergencyHotline
from .views import GROUP_ROLE_MAP

_MOBILE = re.compile(r"^(?:\+63|0)9\d{9}$")
_LANDLINE = re.compile(r"^(?:\+63|0)[2-8]\d{8,9}$")
_SHORT = re.compile(r"^[1-9]\d{2,3}$")  # e.g. 911, 8888


def normalize_phone(raw):
    """Returns the cleaned number, or None if it is not a valid PH mobile,
    landline (with area code) or 3-4 digit emergency number."""
    cleaned = re.sub(r"[\s\-().]", "", str(raw or ""))
    if _MOBILE.match(cleaned) or _LANDLINE.match(cleaned) or _SHORT.match(cleaned):
        return cleaned
    return None


def _headers(response):
    response["Access-Control-Allow-Origin"] = "*"
    response["Access-Control-Allow-Headers"] = "Content-Type"
    response["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return response


def _json(payload, status=200):
    return _headers(JsonResponse(payload, status=status))


def _current():
    row = EmergencyHotline.objects.filter(pk=1).first()
    if not row or not row.phone_number:
        return {"success": True, "phone_number": None, "label": "DRRM Emergency Hotline",
                "updated_at": None, "updated_by": None}
    return {"success": True, "phone_number": row.phone_number, "label": "DRRM Emergency Hotline",
            "updated_at": row.updated_at.isoformat(), "updated_by": row.updated_by}


@csrf_exempt
def drrm_emergency_hotline(request):
    """GET (no login): current hotline, used by the resident app and DRRM form.
    POST {username, password, phone_number}: save/update. The password is
    re-verified against Django and the account must be in the DRRM group;
    the client-supplied username alone is never trusted."""
    if request.method == "OPTIONS":
        return _headers(JsonResponse({}))
    if request.method == "GET":
        return _json(_current())
    if request.method != "POST":
        return _json({"success": False, "message": "GET or POST required."}, 405)

    try:
        data = json.loads(request.body or "{}")
        if not isinstance(data, dict):
            raise ValueError
    except (ValueError, UnicodeDecodeError):
        return _json({"success": False, "message": "Invalid JSON body."}, 400)

    username = str(data.get("username") or "").strip()
    password = str(data.get("password") or "")
    if not username or not password:
        return _json({"success": False, "message": "Enter your DRRM password to save."}, 400)

    key = "geoaid-hotline:" + hashlib.sha256(username.lower().encode()).hexdigest()[:24]
    if cache.get(key, 0) >= 5:
        return _json({"success": False, "message": "Too many failed attempts. Try again in 15 minutes."}, 429)
    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        cache.set(key, cache.get(key, 0) + 1, 15 * 60)
        return _json({"success": False, "message": "Incorrect password."}, 401)
    group = user.groups.first()
    role = GROUP_ROLE_MAP.get(group.name.strip().lower(), "") if group else ""
    if role != "drrm":
        return _json({"success": False, "message": "Only DRRM officers can change the emergency hotline."}, 403)
    cache.delete(key)

    phone = normalize_phone(data.get("phone_number"))
    if phone is None:
        return _json({"success": False, "message": "Enter a valid Philippine mobile (09XXXXXXXXX), "
                      "landline with area code (e.g. 088 123 4567), or 3-4 digit hotline."}, 400)

    EmergencyHotline.objects.update_or_create(
        pk=1, defaults={"phone_number": phone, "updated_by": user.username, "updated_at": timezone.now()})
    return _json(dict(_current(), message="Emergency hotline saved."))
