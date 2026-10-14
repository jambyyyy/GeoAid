"""DRRM-managed emergency contacts: public read, DRRM-only write (password-unlocked token)."""
import hashlib
import json

from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.core import signing
from django.core.cache import cache
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .hotline_views import normalize_phone
from .models import EmergencyContact
from .views import GROUP_ROLE_MAP

SALT = "geoaid.drrm.contacts"
MAX_AGE = 8 * 60 * 60
CATEGORIES = dict(EmergencyContact.CATEGORY_CHOICES)
# resident app card colour group
_TYPE = {"drrm": "government", "police": "emergency", "fire": "emergency", "hospital": "emergency",
         "rescue": "emergency", "other": "government"}


def _resp(payload, status=200):
    r = JsonResponse(payload, status=status)
    r["Access-Control-Allow-Origin"] = "*"
    r["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
    r["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return r


def _err(message, status=400, **extra):
    return _resp(dict({"success": False, "message": message}, **extra), status)


def _is_drrm(user):
    g = user.groups.first()
    return bool(g) and GROUP_ROLE_MAP.get(g.name.strip().lower(), "") == "drrm"


def _fp(user):
    return hashlib.sha256((user.password or "").encode()).hexdigest()[:16]


def _row(c):
    return {"id": c.id, "name": c.name, "phone": c.phone_number, "category": c.category,
            "category_label": CATEGORIES.get(c.category, "Other"),
            "type": _TYPE.get(c.category, "government"),
            "updated_by": c.updated_by, "updated_at": c.updated_at.isoformat()}


def _body(request):
    try:
        d = json.loads(request.body or "{}")
        return d if isinstance(d, dict) else None
    except (ValueError, UnicodeDecodeError):
        return None


@csrf_exempt
def emergency_contacts(request):
    """GET (public): {contacts:[...], categories:[...]}. Used by the resident app and DRRM page."""
    if request.method == "OPTIONS":
        return _resp({})
    if request.method != "GET":
        return _err("GET required.", 405)
    return _resp({"success": True, "contacts": [_row(c) for c in EmergencyContact.objects.all()],
                  "categories": [{"value": k, "label": v} for k, v in CATEGORIES.items()]})


@csrf_exempt
def drrm_contacts_unlock(request):
    """POST {username, password} -> {token}. DRRM accounts only; failed attempts are limited."""
    if request.method == "OPTIONS":
        return _resp({})
    if request.method != "POST":
        return _err("POST required.", 405)
    d = _body(request)
    if d is None:
        return _err("Invalid JSON body.")
    username = str(d.get("username") or "").strip()
    password = str(d.get("password") or "")
    if not username or not password:
        return _err("Enter your DRRM password.")
    key = "geoaid-contacts:" + hashlib.sha256(username.lower().encode()).hexdigest()[:24]
    if cache.get(key, 0) >= 5:
        return _err("Too many failed attempts. Try again in 15 minutes.", 429)
    user = authenticate(username=username, password=password)
    if not user or not user.is_active:
        cache.set(key, cache.get(key, 0) + 1, 15 * 60)
        return _err("Incorrect password.", 401)
    if not _is_drrm(user):
        return _err("Only DRRM officers can manage emergency contacts.", 403)
    cache.delete(key)
    token = signing.dumps({"u": user.username, "p": _fp(user)}, salt=SALT)
    return _resp({"success": True, "token": token})


def _authorize(request):
    h = request.META.get("HTTP_AUTHORIZATION", "")
    if not h.startswith("Bearer "):
        return None, _err("Confirm your DRRM password first.", 401, auth_required=True)
    try:
        data = signing.loads(h[7:].strip(), salt=SALT, max_age=MAX_AGE)
    except signing.BadSignature:
        return None, _err("Your session expired. Confirm your password again.", 401, auth_required=True)
    user = User.objects.filter(username=data.get("u"), is_active=True).first()
    if not user or data.get("p") != _fp(user):
        return None, _err("Your session is no longer valid. Confirm your password again.", 401, auth_required=True)
    if not _is_drrm(user):
        return None, _err("Only DRRM officers can manage emergency contacts.", 403)
    return user, None


@csrf_exempt
def drrm_contacts_manage(request):
    """POST (Bearer token) {action: add|update|delete, id, name, phone_number, category}."""
    if request.method == "OPTIONS":
        return _resp({})
    if request.method != "POST":
        return _err("POST required.", 405)
    user, bad = _authorize(request)
    if bad:
        return bad
    d = _body(request)
    if d is None:
        return _err("Invalid JSON body.")
    action = str(d.get("action") or "").lower()

    if action == "delete":
        deleted, _ = EmergencyContact.objects.filter(pk=d.get("id")).delete() if str(d.get("id") or "").isdigit() else (0, 0)
        if not deleted:
            return _err("Contact not found.", 404)
        return _resp({"success": True, "message": "Contact removed."})

    if action not in ("add", "update"):
        return _err("Unknown action.")
    name = " ".join(str(d.get("name") or "").split())
    category = str(d.get("category") or "other")
    phone = normalize_phone(d.get("phone_number"))
    if not name:
        return _err("Enter the contact name (e.g. Iligan City Police Station).")
    if len(name) > 100:
        return _err("Name is too long (100 characters max).")
    if category not in CATEGORIES:
        return _err("Choose a valid category.")
    if phone is None:
        return _err("Enter a valid Philippine mobile (09XXXXXXXXX), landline with area code "
                    "(e.g. 088 123 4567), or 3-4 digit hotline.")

    dupes = EmergencyContact.objects.filter(name__iexact=name)
    if action == "update":
        if not str(d.get("id") or "").isdigit():
            return _err("Contact not found.", 404)
        dupes = dupes.exclude(pk=d["id"])
    if dupes.exists():
        return _err("A contact with that name already exists. Edit it instead.")

    if action == "add":
        c = EmergencyContact.objects.create(name=name, phone_number=phone, category=category,
                                            updated_by=user.username)
    else:
        c = EmergencyContact.objects.filter(pk=d["id"]).first()
        if not c:
            return _err("Contact not found.", 404)
        c.name, c.phone_number, c.category = name, phone, category
        c.updated_by, c.updated_at = user.username, timezone.now()
        c.save()
    return _resp({"success": True, "contact": _row(c), "message": "Contact saved."})
