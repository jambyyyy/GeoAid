from django.db import models
from django.contrib.auth.hashers import make_password, check_password
from django.contrib.auth.models import User
from django.utils import timezone
import random
import uuid


class Barangay(models.Model):
    """New table matching the thesis ERD's barangay entity. This is
    ADDITIVE — Household.barangay and EvacuationCenter.barangay (both
    plain text fields) are untouched and every existing view that reads
    them keeps working exactly as before. Household.barangay_fk and
    EvacuationCenter.barangay_fk below are new nullable columns that
    point here, kept in sync by a one-time backfill script rather than
    replacing the text fields outright."""

    barangay_name = models.CharField(max_length=50, unique=True)
    # Centroid of the barangay — needed to draw it on the DRRM evacuation
    # map and to use it as a node when routing (see routing.py). Nullable so
    # existing rows keep working; barangays without coordinates are simply
    # left off the map until you fill them in (Django admin > Barangays, or
    # run `python manage.py seed_map_data`).
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "Barangays"

    def __str__(self):
        return self.barangay_name


class Purok(models.Model):
    """New table to store purok information and resident routes.
    This allows tracking of purok-specific data and evacuation routes
    from purok to barangay/evacuation centers."""

    barangay = models.ForeignKey(
        Barangay, on_delete=models.CASCADE, related_name="puroks"
    )
    purok_name = models.CharField(max_length=100)
    # Route information from purok to barangay/evacuation center
    route_description = models.TextField(blank=True)
    route_distance = models.CharField(max_length=50, blank=True)
    estimated_time = models.CharField(max_length=50, blank=True)
    # Coordinates for the purok (optional, for mapping)
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    class Meta:
        verbose_name_plural = "Puroks"
        unique_together = ('barangay', 'purok_name')

    @staticmethod
    def options():
        """{barangay_name: [purok names]} — the purok list used by the
        resident registration dropdown and by Purok President scoping.
        The Purok table (Django admin > Puroks) is the source of truth for
        any barangay that has rows in it; barangays with no rows yet fall
        back to Household.PUROK_CHOICES_BY_BARANGAY, so nothing breaks
        before the table is filled (run `python manage.py seed_puroks`)."""
        out = {}
        for p in Purok.objects.select_related("barangay").order_by("purok_name"):
            out.setdefault(p.barangay.barangay_name, []).append(p.purok_name)
        for brgy, names in Household.PUROK_CHOICES_BY_BARANGAY.items():
            out.setdefault(brgy, list(names))
        return out

    @staticmethod
    def match(barangay_name, purok_name):
        """The Purok row for a (barangay, purok) text pair, or None."""
        if not barangay_name or not purok_name:
            return None
        return Purok.objects.filter(
            barangay__barangay_name__iexact=barangay_name.strip(),
            purok_name__iexact=purok_name.strip(),
        ).first()

    def __str__(self):
        return f"{self.purok_name} - {self.barangay.barangay_name}"


class DisasterType(models.Model):
    """New table matching the thesis ERD's disaster_type entity —
    ties an Attendance record (and eventually donation/relief_distribution/
    report) to a specific disaster event, e.g. 'Typhoon Sendong 2026'."""

    STATUS_CHOICES = [("active", "Active"), ("closed", "Closed")]

    disaster_type_name = models.CharField(max_length=100)
    start_date = models.DateField(null=True, blank=True)
    end_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="active")

    def __str__(self):
        return self.disaster_type_name


class Report(models.Model):
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports"
    )
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports"
    )
    title = models.CharField(max_length=200)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


# Shared priority formula used by the vulnerability profiles (stored in
# VulnerabilityProfile.priority_score) and by every dashboard payload, so
# the score is identical everywhere. PWD/Pregnant count double since they
# usually need more direct assistance than the other groups.
VULNERABILITY_WEIGHTS = {"PWD": 2, "Pregnant": 2, "Elderly": 1, "Child<5": 1}


def priority_from_flags(flags):
    """flags: iterable of "PWD"/"Pregnant"/"Elderly"/"Child<5".
    Returns (priority_score, priority_level)."""
    score = sum(VULNERABILITY_WEIGHTS.get(f, 0) for f in flags)
    if score >= 3:
        return score, "High"
    if score >= 1:
        return score, "Medium"
    return score, "Low"


class Household(models.Model):
    """A resident account created through the GeoAid Resident app's
    registration flow (Steps 1-4: Account, Household, Members,
    Vulnerability). This is intentionally separate from the staff
    `User`/Group accounts used in login_user — residents sign in with
    a mobile number + password, not a username, and don't need
    Django's admin/permissions machinery."""

    # Barangay is no longer a hardcoded list here — it's driven by the
    # Barangay table (see Barangay model above), managed through Django
    # admin. Use Household.barangay_choices() anywhere a (value, label)
    # choices list is needed (forms, admin dropdowns, etc.); it's built
    # fresh from the database each time it's called, so adding/removing
    # a Barangay row is all that's needed to update every dropdown.

    # Purok/Zone options per barangay, sourced from CDRRMO flood advisories,
    # news coverage of Tropical Storm Basyang (Feb 2026) and Typhoon Sendong,
    # and barangay purok listings — prioritizing puroks that show up
    # repeatedly as flood/landslide-affected so the most at-risk areas are
    # selectable, not just numbered placeholders. Each barangay actually has
    # many more puroks than this; this list is a starting point, not the
    # full official roster.
    PUROK_CHOICES_BY_BARANGAY = {
        "Mahayahay": ["Riverside Zone 1", "Riverside Zone 2", "Purok 3"],
        "Tambacan": ["Purok 1-A", "Purok 2-A", "Purok 4-B", "Purok 8", "Purok 8-A", "Purok 9"],
        "Abuno": ["Purok 6 (Malindawag)", "Panul-iran"],
        "Hinaplanon": ["Purok Dao", "Bayug Island"],
        "Pala-o Riverside": ["Purok 15", "Zone 7 / Purok 6"],
        "Tubod": ["Purok Manuang", "Purok Green Valley"],
        "Tipanoy": ["Purok 1-A (Bernales)", "Purok 4 (Upper Pindugangan)", "Purok 5"],
    }

    @staticmethod
    def purok_choices(barangay_name):
        """(value, label) pairs built live from the Purok table for a specific barangay.
        Returns empty list if barangay not found or has no puroks."""
        try:
            barangay = Barangay.objects.get(barangay_name=barangay_name)
            return [
                (purok.purok_name, purok.purok_name)
                for purok in Purok.objects.filter(barangay=barangay).order_by('purok_name')
            ]
        except Barangay.DoesNotExist:
            return []

    DWELLING_TYPE_CHOICES = [
        ("concrete", "Concrete"),
        ("semi_concrete", "Semi-concrete"),
        ("wood", "Wood / Light materials"),
        ("makeshift", "Makeshift / Informal settler structure"),
    ]

    @staticmethod
    def barangay_choices():
        """(value, label) pairs built live from the Barangay table —
        the single source of truth for barangay names across the app.
        Not stored as a model-field `choices=` list because that would
        be baked in at import time; call this wherever a fresh list is
        needed instead (forms, admin, API responses)."""
        return [
            (name, name)
            for name in Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)
        ]

    # --- Step 1: Account Setup ---
    household_code = models.CharField(max_length=24, unique=True, editable=False)
    full_name = models.CharField(max_length=150)
    mobile_number = models.CharField(max_length=20, unique=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    # --- Step 2: Household Setup ---
    # Plain text field, no hardcoded `choices=` — valid values come from
    # the Barangay table (see barangay_choices() above). Kept as free
    # text rather than a required FK so existing rows/behavior are
    # untouched; barangay_fk below is the real relation going forward.
    barangay = models.CharField(max_length=50, blank=True)
    # New FK matching the ERD's household.barangay_id — additive, populated
    # by a backfill script from the `barangay` text field above. Existing
    # code (_barangay_for_username, barangay_dashboard, etc.) keeps using
    # `barangay` (the text field); use barangay_fk for new ERD-aligned code.
    barangay_fk = models.ForeignKey(
        Barangay, on_delete=models.SET_NULL, null=True, blank=True, related_name="households"
    )
    purok = models.CharField(max_length=100, blank=True)
    # Foreign key to Purok for route information
    purok_fk = models.ForeignKey(
        Purok, on_delete=models.SET_NULL, null=True, blank=True, related_name="households"
    )
    address_line = models.CharField(max_length=255, blank=True)
    landmark = models.CharField(max_length=255, blank=True)
    dwelling_type = models.CharField(max_length=20, choices=DWELLING_TYPE_CHOICES, blank=True)
    gps_lat = models.FloatField(null=True, blank=True)
    gps_lng = models.FloatField(null=True, blank=True)

    # Set once Steps 2-4 have all been submitted via register/complete/
    registration_complete = models.BooleanField(default=False)

    # Lifecycle: resident submits (pending) -> Purok President reviews
    # (approved/rejected) -> if approved, Barangay Staff gives final
    # confirmation (confirmed/rejected). Only "confirmed" households are
    # surfaced city-wide to CSWD and DRRM dashboards.
    STATUS_CHOICES = [
        ("pending", "Pending Review"),
        ("approved", "Approved by Purok President"),
        ("confirmed", "Confirmed by Barangay Staff"),
        ("rejected", "Rejected"),
    ]
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="pending")

    @property
    def vulnerability(self):
        """This household's current VulnerabilityProfile (highest score
        first), or None if it hasn't been profiled yet. Use
        household.vulnerability_profiles for every row."""
        return self.vulnerability_profiles.order_by("-priority_score", "-updated_at").first()

    def set_password(self, raw_password):
        self.password_hash = make_password(raw_password)

    def check_password(self, raw_password):
        return check_password(raw_password, self.password_hash)

    def save(self, *args, **kwargs):
        if not self.household_code:
            self.household_code = self._generate_unique_code()
        # Keep the purok_fk link in step with the barangay/purok text the
        # resident picked (None when the name isn't in the Purok table).
        self.purok_fk = Purok.match(self.barangay, self.purok)
        super().save(*args, **kwargs)

    @staticmethod
    def _generate_unique_code():
        year = timezone.now().year
        while True:
            candidate = f"GAID-{year}-{random.randint(1000, 9999)}"
            if not Household.objects.filter(household_code=candidate).exists():
                return candidate

    def __str__(self):
        return f"{self.full_name} ({self.mobile_number})"


class FamilyMember(models.Model):
    """A member of a Household, captured in Step 3 (Household Members)
    and flagged in Step 4 (Vulnerability Assessment). One household can
    have many family members."""

    RELATION_CHOICES = [
        ("Head", "Head of Household"),
        ("Spouse", "Spouse"),
        ("Child", "Child"),
        ("Parent", "Parent"),
        ("Sibling", "Sibling"),
        ("Grandchild", "Grandchild"),
        ("Other", "Other"),
    ]

    household = models.ForeignKey(
        Household,
        on_delete=models.CASCADE,
        related_name="family_members",
    )

    full_name = models.CharField(max_length=150)

    age = models.PositiveIntegerField()

    relation = models.CharField(
        max_length=20,
        choices=RELATION_CHOICES,
        default="Other",
    )

    # Optional profile picture
    image = models.ImageField(
        upload_to="family_members/",
        blank=True,
        null=True,
    )

    is_pwd = models.BooleanField(default=False)

    pwd_detail = models.CharField(
        max_length=255,
        blank=True,
    )

    is_pregnant = models.BooleanField(
        default=False
    )

    pregnant_detail = models.CharField(
        max_length=255,
        blank=True,
    )

    qr_code = models.CharField(
        max_length=255,
        unique=True,
        blank=True,
        null=True,
    )

    @property
    def is_elderly(self):
        return self.age >= 60

    @property
    def is_child_under5(self):
        return self.age < 5

    def __str__(self):
        return (
            f"{self.full_name} "
            f"({self.relation} of "
            f"{self.household.full_name})"
        )

class VulnerabilityProfile(models.Model):
    """Matches the thesis ERD's vulnerability_profiling entity. One row
    per household per disaster (disaster_type is NULL when no disaster is
    active, i.e. a general profile). `family_member` is the member who
    drives the household's priority (e.g. the PWD / pregnant member), kept
    to match the ERD's family_members_id FK; it is NULL when the
    household has no vulnerable member.

    Rows are (re)computed by sync_vulnerability_profile() from the
    FamilyMember flags (PWD, pregnant, 60+, under 5), so they never need to be
    typed in by hand."""

    LEVEL_CHOICES = [("High", "High"), ("Medium", "Medium"), ("Low", "Low")]

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="vulnerability_profiles"
    )
    family_member = models.ForeignKey(
        FamilyMember, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="vulnerability_profiles",
    )
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="vulnerability_profiles",
    )
    priority_score = models.PositiveIntegerField(default=0)
    priority_level = models.CharField(max_length=6, choices=LEVEL_CHOICES, default="Low")
    # Comma-separated snapshot of the flags behind the score, e.g. "PWD,Elderly".
    flags = models.CharField(max_length=100, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-priority_score", "household_id"]

    @property
    def flag_list(self):
        return [f for f in self.flags.split(",") if f]

    def __str__(self):
        return f"{self.household.household_code} - {self.priority_level} ({self.priority_score})"


def sync_vulnerability_profile(household):
    """Recompute and save the VulnerabilityProfile row(s) for a household:
    one per currently active DisasterType, or a single general row
    (disaster_type=None) when no disaster is active. Returns the rows."""

    flags = set()
    driver = None  # the member with the heaviest flags
    driver_weight = 0
    for m in household.family_members.all():
        member_flags = set()
        if m.is_pwd:
            member_flags.add("PWD")
        if m.is_pregnant:
            member_flags.add("Pregnant")
        if m.is_elderly:
            member_flags.add("Elderly")
        if m.is_child_under5:
            member_flags.add("Child<5")
        flags |= member_flags
        w = sum(VULNERABILITY_WEIGHTS.get(f, 0) for f in member_flags)
        if w > driver_weight:
            driver, driver_weight = m, w

    score, level = priority_from_flags(flags)
    values = {
        "family_member": driver,
        "priority_score": score,
        "priority_level": level,
        "flags": ",".join(sorted(flags)),
    }

    targets = list(DisasterType.objects.filter(status="active")) or [None]
    rows = []
    for dt in targets:
        row, _ = VulnerabilityProfile.objects.update_or_create(
            household=household, disaster_type=dt, defaults=values
        )
        rows.append(row)
    return rows


class EvacuationCenter(models.Model):
    """An evacuation center, scoped to a barangay so Barangay Staff's
    mobile dashboard (barangay_evacuation_dashboard) can find the one
    their account is responsible for — the same way households are
    scoped, by matching the staff user's First Name in Django admin
    against the Barangay table (see Household.barangay_choices())."""

    STATUS_CHOICES = [("open", "Open"), ("closed", "Closed")]

    name = models.CharField(max_length=150)
    # Plain text, no hardcoded `choices=` — see Household.barangay above
    # for why. Valid values come from the Barangay table.
    barangay = models.CharField(max_length=50)
    # New FK matching the ERD's evacuation_center.barangay_id — additive,
    # same backfill approach as Household.barangay_fk above.
    barangay_fk = models.ForeignKey(
        Barangay, on_delete=models.SET_NULL, null=True, blank=True, related_name="evacuation_centers"
    )
    capacity = models.PositiveIntegerField(default=0)
    current_occupancy = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="open")
    # Exact location of the center for the evacuation map. If left blank
    # the map falls back to the barangay's centroid (and flags it as
    # approximate), so set these for accurate routes.
    latitude = models.FloatField(null=True, blank=True)
    longitude = models.FloatField(null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.barangay})"


class Attendance(models.Model):
    """Evacuation center check-in/check-out record, created by
    attendance_scan() each time a Barangay Staff member scans a
    resident's QR code (FamilyMember.qr_code). Mirrors Table 3.25 of
    the GeoAid thesis."""

    STATUS_CHOICES = [("Present", "Present"), ("Checked Out", "Checked Out")]

    family_member = models.ForeignKey(
        FamilyMember, on_delete=models.CASCADE, related_name="attendance_records"
    )
    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="attendance_records"
    )
    evacuation_center = models.ForeignKey(
        EvacuationCenter, on_delete=models.CASCADE, related_name="attendance_records"
    )
    # Matches the thesis ERD's attendance.disaster_type_id. Nullable since
    # not every check-in will necessarily be tagged to a specific active
    # disaster at scan time — attendance_scan() can be updated to set this
    # once you're ready to pass it from the scanner.
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="attendance_records"
    )
    check_in_time = models.DateTimeField(null=True, blank=True)
    check_out_time = models.DateTimeField(null=True, blank=True)
    attendance_status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="Present")

    def __str__(self):
        return f"{self.family_member.full_name} @ {self.evacuation_center.name} ({self.attendance_status})"


class Donation(models.Model):
    """Matches the ERD's donation entity — a single donation drop-off
    (goods, not cash) logged by a staff account (CSWD for now). Feeds
    the CSWD Dashboard's Donations tab, which previously showed a
    static, made-up inventory list."""

    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("received", "Received"),
        ("distributed", "Distributed"),
    ]

    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="donations"
    )
    donor_name = models.CharField(max_length=150)
    contact_num = models.CharField(max_length=20, blank=True)
    goods_type = models.CharField(max_length=100)
    quantity = models.PositiveIntegerField(default=0)
    # Unit the quantity was counted in when it was logged: "pcs" or "kg".
    unit = models.CharField(max_length=20, default="pcs")
    donation_date = models.DateField(default=timezone.now)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pending")
    # True once this donation's quantity has been added to ReliefStock.
    # Default True on purpose: every row that existed before this field was
    # added was already counted by the old logic, so the migration must NOT
    # mark them uncounted (that would double count them when marked received).
    # New rows are always created with an explicit value (see cswd_add_donation).
    stock_counted = models.BooleanField(default=True)

    class Meta:
        ordering = ["-donation_date"]

    def __str__(self):
        return f"{self.donor_name} — {self.goods_type} x{self.quantity}"


# Goods that can be RELEASED to barangays are the five PACK types below.
# Individual items (rice, canned goods, noodles, medicine, water bottles...)
# stay in the inventory and leave it by being assembled into a pack in the
# Pack Builder. Every inventory item has a category, and the category
# decides which pack type it can go into. Pack names are matched
# case-insensitively in the views; the label helper capitalises them.
RICE_PACK = "rice pack"
CANNED_PACK = "canned goods pack"
FOOD_PACK = "food pack"
MEDICINE_PACK = "medicine pack"
WATER_PACK = "water pack"
GOODS_TYPES = (RICE_PACK, CANNED_PACK, FOOD_PACK, MEDICINE_PACK, WATER_PACK)
# The goods types that are made by packing other items (all of them).
PACK_TYPES = GOODS_TYPES

# Inventory item categories -> the pack type the item goes into.
CATEGORY_CHOICES = [
    ("rice", "Rice"),
    ("canned_noodles", "Canned Goods & Noodles"),
    ("medicine", "Medicine"),
    ("water", "Water"),
]
CATEGORY_TO_PACK = {
    "rice": RICE_PACK,
    "canned_noodles": FOOD_PACK,
    "medicine": MEDICINE_PACK,
    "water": WATER_PACK,
}
CATEGORY_LABELS = dict(CATEGORY_CHOICES)
# Display name of each pack type's category (used by the dashboard).
PACK_CATEGORY = {v: k for k, v in CATEGORY_TO_PACK.items()}


def goods_label(value):
    value = (value or "").strip()
    return value[:1].upper() + value[1:]


class GoodsLabelMixin:
    """Gives get_goods_type_display() for the pack goods types."""

    def get_goods_type_display(self):
        return goods_label(self.goods_type)


class ReliefStock(GoodsLabelMixin, models.Model):
    """Simple relief-goods storage: one row per goods type (rice, canned
    sardines, noodles, paracetamol, water bottles, ... and the four pack
    types), holding the quantity currently on hand. It goes up when goods
    are stored (cswd_add_relief_stock, cswd_add_donation) and down
    whenever a ReliefDistribution record is created
    (cswd_record_relief). There is no separate movement history."""

    goods_type = models.CharField(max_length=100, unique=True)
    # Unit the quantity is counted in: "kg" for rice, "pcs" for canned
    # goods, "pack" for the assembled relief packs, etc. Free text so CSWD
    # can add any new item with its own unit (Inventory tab).
    unit = models.CharField(max_length=20, default="pcs")
    # "Good for": the pack this item is meant for ("rice pack", "food pack",
    # "medicine pack" or "water pack"), chosen when the item is added or
    # donated, so the Inventory can show just the items for the pack being
    # made. Blank for the pack types themselves and for older items.
    category = models.CharField(max_length=20, blank=True, default="")
    quantity = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["goods_type"]

    def __str__(self):
        return f"{self.get_goods_type_display()}: {self.quantity} {self.unit} left"


# Units the two built-in goods are counted in. Used when their rows are
# first created (and to fix rows created before units existed).
DEFAULT_UNITS = {g: "pack" for g in GOODS_TYPES}


class PackComponent(models.Model):
    """One line of the standard relief-pack recipe: how much of an
    inventory item goes into ONE pack (e.g. 2 pcs of canned sardines).
    CSWD edits the recipe from the Pack Builder in Relief Distribution and
    then assembles packs: assembling N packs of a pack type deducts
    quantity_per_pack x N of every component whose category belongs to that
    pack type and adds N to that pack type's stock."""

    item = models.OneToOneField(
        ReliefStock, on_delete=models.CASCADE, related_name="pack_component"
    )
    quantity_per_pack = models.PositiveIntegerField(default=1)
    # Which pack this item goes into: "rice pack", "food pack",
    # "medicine pack" or "water pack". CSWD chooses it in the Pack Builder
    # (blank on older rows = food pack).
    pack_type = models.CharField(max_length=20, blank=True, default="")

    class Meta:
        ordering = ["item__goods_type"]

    def __str__(self):
        return f"{self.quantity_per_pack} {self.item.unit} {self.item.goods_type} per pack"


class InventoryMovement(models.Model):
    """Stock ledger: one row every time the quantity of an inventory item
    changes, so the inventory shows WHEN things were stored and WHEN they
    went out, and why. Stock goes IN from donations, restocks, opening
    stock and finished packs; it goes OUT when items are used to make a
    pack and when packs are released to a barangay. balance_after is the
    quantity on hand right after the movement."""

    IN = "in"
    OUT = "out"
    MOVEMENT_TYPES = [(IN, "Stored"), (OUT, "Out")]
    REASONS = [
        ("donation", "Donation"),
        ("restock", "Restock"),
        ("initial", "Opening stock"),
        ("pack_made", "Pack made"),
        ("packed", "Used in a pack"),
        ("released", "Released to barangay"),
        ("purchase", "Relief purchase"),
        ("adjustment", "Stock adjustment"),
    ]

    item = models.ForeignKey(ReliefStock, on_delete=models.CASCADE, related_name="movements")
    movement_type = models.CharField(max_length=3, choices=MOVEMENT_TYPES)
    reason = models.CharField(max_length=20, choices=REASONS)
    quantity = models.PositiveIntegerField()
    balance_after = models.PositiveIntegerField(default=0)
    details = models.CharField(max_length=255, blank=True, default="")
    recorded_by = models.CharField(max_length=100, blank=True, default="")
    moved_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-moved_at", "-id"]

    def __str__(self):
        sign = "+" if self.movement_type == self.IN else "-"
        return f"{self.item.goods_type} {sign}{self.quantity} ({self.reason})"


class ReliefDistribution(GoodsLabelMixin, models.Model):
    """Matches the ERD's relief_distribution entity (household_id,
    disaster_type_id, quantity_given, distribution_date, tracking_number,
    claim_status), with one addition: goods_type, so a release is either
    one of the four pack types and can be matched back against ReliefStock. Creating
    one of these deducts quantity_given from the matching ReliefStock row
    — see cswd_record_relief.

    Releases are now made PER BARANGAY (to the barangay's evacuation
    center), not per household: `household` is therefore optional and
    only set on older rows created before this change. New rows carry
    `barangay` (+ optionally `evacuation_center`) and `households_served`,
    a snapshot of how many households were in that evacuation center
    (or, with no center, confirmed in that barangay) when it was recorded."""

    # Lifecycle: CSWD records a release (processing) -> marks it ready for
    # pickup (ready) -> the resident confirms in the mobile app that they
    # got it (claimed). CSWD can also cancel an open release, which puts
    # the goods back into stock. "pending" is kept only so older rows
    # created before this workflow still display correctly.
    CLAIM_STATUS_CHOICES = [
        ("processing", "Processing"),
        ("ready", "Ready for Pickup"),
        ("claimed", "Claimed"),
        ("cancelled", "Cancelled"),
        ("pending", "Pending"),
    ]

    # Legacy per-household link — null for barangay-level releases.
    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="relief_records",
        null=True, blank=True,
    )
    # Barangay-level release target — ERD relief_distribution.barangay_id.
    barangay = models.ForeignKey(
        Barangay, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="relief_distributions",
    )
    evacuation_center = models.ForeignKey(
        EvacuationCenter, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="relief_distributions",
    )
    # Households inside the evacuation center (or confirmed in the
    # barangay when no center is chosen) at the time of release.
    households_served = models.PositiveIntegerField(default=0)
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True,
        related_name="relief_distributions"
    )
    goods_type = models.CharField(max_length=100)
    quantity_given = models.PositiveIntegerField(default=0)
    distribution_date = models.DateTimeField(default=timezone.now)
    tracking_number = models.CharField(max_length=40, unique=True, blank=True)
    claim_status = models.CharField(max_length=10, choices=CLAIM_STATUS_CHOICES, default="processing")
    # Set when the release is marked claimed (by the resident in the
    # mobile app, or by CSWD).
    claimed_at = models.DateTimeField(null=True, blank=True)
    # Who last changed claim_status ("resident" when confirmed in the app).
    status_updated_by = models.CharField(max_length=150, blank=True)
    distributed_by = models.CharField(max_length=150, blank=True)
    remarks = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-distribution_date"]

    def save(self, *args, **kwargs):
        if not self.tracking_number:
            self.tracking_number = f"RD-{timezone.now().strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:12].upper()}"
        super().save(*args, **kwargs)

    def __str__(self):
        target = self.barangay.barangay_name if self.barangay_id else self.household_id
        return f"{target} — {self.goods_type} x{self.quantity_given}"


class EvacuationRoute(models.Model):
    """Matches the thesis ERD's evacuation_route entity — a route DRRM
    Officers can pin to a specific EvacuationCenter, so residents/staff
    know which road to use and its current condition during an
    evacuation. route_distance and estimated_time are free text
    ("2.4 km", "15 mins") rather than fixed numeric units, since exact
    formats/units weren't specified and text keeps the form flexible."""

    ROAD_CONDITION_CHOICES = [
        ("clear", "Clear"),
        ("passable", "Passable"),
        ("flooded", "Flooded"),
        ("landslide_risk", "Landslide Risk"),
        ("impassable", "Impassable"),
    ]
    # route_status doubles as the route's risk level (this replaced the old
    # RiskArea table): "safe" .. "critical" say how dangerous the route is.
    # A route counts toward the barangay named in start_location.
    ROUTE_STATUS_CHOICES = [
        ("active", "Active"),
        ("under_review", "Under Review"),
        ("blocked", "Blocked"),
        ("safe", "Safe"),
        ("low", "Low Risk"),
        ("medium", "Medium Risk"),
        ("high", "High Risk"),
        ("critical", "Critical Risk"),
    ]

    evacuation_center = models.ForeignKey(
        EvacuationCenter, on_delete=models.CASCADE, related_name="evacuation_routes"
    )
    start_location = models.CharField(max_length=255)
    route_distance = models.CharField(max_length=50, blank=True)
    estimated_time = models.CharField(max_length=50, blank=True)
    road_condition = models.CharField(max_length=20, choices=ROAD_CONDITION_CHOICES, default="clear")
    route_status = models.CharField(max_length=15, choices=ROUTE_STATUS_CHOICES, default="active")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.start_location} → {self.evacuation_center.name}"


# ---------------------------------------------------------------------------
# Cash donations and relief-goods purchasing
# ---------------------------------------------------------------------------
from decimal import Decimal
from django.core.files.storage import FileSystemStorage
from django.conf import settings as _settings
from pathlib import Path as _Path


def _receipt_root():
    """Receipts live OUTSIDE MEDIA_ROOT and are never served by a static/media
    URL; they are streamed only through the authenticated receipt view."""
    root = getattr(_settings, "RECEIPT_STORAGE_ROOT", None)
    if not root:
        root = _Path(_settings.BASE_DIR) / "private_receipts"
    return str(root)


class PrivateReceiptStorage(FileSystemStorage):
    """Private receipt storage. The folder is read from settings every time it
    is used (not frozen at import), and there is no public URL."""

    def __init__(self, *args, **kwargs):
        kwargs["base_url"] = None  # no public URL
        super().__init__(*args, **kwargs)

    def url(self, name):
        raise ValueError("Receipts are private and have no public URL.")

    @property
    def base_location(self):
        return _receipt_root()

    @property
    def location(self):
        import os
        return os.path.abspath(_receipt_root())

    def deconstruct(self):  # keep migrations independent of the machine's path
        return (f"{self.__class__.__module__}.{self.__class__.__name__}", [], {})


def receipt_storage():
    return PrivateReceiptStorage()


def _check(q, name):
    """CheckConstraint that works on Django 4.2/5.0 (check=) and 5.1+ (condition=)."""
    try:
        return models.CheckConstraint(condition=q, name=name)
    except TypeError:
        return models.CheckConstraint(check=q, name=name)


def _new_code(prefix):
    return f"{prefix}-{timezone.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:10].upper()}"


class CashFund(models.Model):
    """Single row (pk=1) used ONLY as a lock: every cash donation or purchase
    does select_for_update() on it, so two simultaneous requests can never
    spend the same balance. Money amounts are never stored here — the balance
    is always computed from CashTransaction rows."""

    updated_at = models.DateTimeField(auto_now=True)


class CashDonation(models.Model):
    request_id = models.UUIDField(unique=True)  # client idempotency key
    transaction_code = models.CharField(max_length=40, unique=True, default="", blank=True)
    donor_name = models.CharField(max_length=150)
    contact_num = models.CharField(max_length=20, blank=True, default="")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    donation_date = models.DateField()
    reference_number = models.CharField(max_length=60, blank=True, default="")
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="cash_donations"
    )
    remarks = models.CharField(max_length=255, blank=True, default="")
    recorded_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-donation_date", "-id"]
        constraints = [
            _check(models.Q(amount__gt=0), "cashdonation_amount_gt_0"),
            models.UniqueConstraint(
                fields=["reference_number"],
                condition=~models.Q(reference_number=""),
                name="cashdonation_reference_unique_when_set",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.transaction_code:
            self.transaction_code = _new_code("CD")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.transaction_code} {self.donor_name} PHP {self.amount}"


class CashPurchase(models.Model):
    request_id = models.UUIDField(unique=True)  # client idempotency key
    purchase_code = models.CharField(max_length=40, unique=True, default="", blank=True)
    supplier_name = models.CharField(max_length=150)
    purchase_date = models.DateField()
    receipt_reference = models.CharField(max_length=60)  # official receipt no.
    total_cost = models.DecimalField(max_digits=12, decimal_places=2)
    receipt_file = models.FileField(upload_to="receipts/", storage=receipt_storage, max_length=200)
    receipt_original_name = models.CharField(max_length=200, blank=True, default="")
    receipt_content_type = models.CharField(max_length=50, blank=True, default="")
    remarks = models.CharField(max_length=255, blank=True, default="")
    recorded_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-purchase_date", "-id"]
        constraints = [
            _check(models.Q(total_cost__gt=0), "cashpurchase_total_gt_0"),
            models.UniqueConstraint(
                fields=["supplier_name", "receipt_reference"], name="cashpurchase_supplier_or_unique"
            ),
        ]

    def save(self, *args, **kwargs):
        if not self.purchase_code:
            self.purchase_code = _new_code("RP")
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.purchase_code} {self.supplier_name} PHP {self.total_cost}"


class CashPurchaseItem(models.Model):
    purchase = models.ForeignKey(CashPurchase, on_delete=models.CASCADE, related_name="items")
    stock = models.ForeignKey(ReliefStock, on_delete=models.PROTECT, related_name="purchase_items")
    item_name = models.CharField(max_length=100)  # snapshot at purchase time
    quantity = models.PositiveIntegerField()
    unit = models.CharField(max_length=20)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        ordering = ["id"]
        constraints = [
            _check(models.Q(quantity__gt=0), "purchaseitem_qty_gt_0"),
            _check(models.Q(unit_price__gt=0), "purchaseitem_price_gt_0"),
        ]


class CashTransaction(models.Model):
    """Ledger. Exactly one of `donation` / `purchase` is set. amount is always
    positive; `kind` says whether it is money in or out."""

    IN = "in"
    OUT = "out"
    KIND_CHOICES = [(IN, "Cash in"), (OUT, "Cash out")]

    kind = models.CharField(max_length=3, choices=KIND_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)
    donation = models.OneToOneField(CashDonation, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entry")
    purchase = models.OneToOneField(CashPurchase, on_delete=models.PROTECT, null=True, blank=True, related_name="ledger_entry")
    description = models.CharField(max_length=255, blank=True, default="")
    recorded_by = models.CharField(max_length=150)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-id"]
        constraints = [
            _check(models.Q(amount__gt=0), "cashtx_amount_gt_0"),
            _check(
                models.Q(kind="in", donation__isnull=False, purchase__isnull=True)
                | models.Q(kind="out", donation__isnull=True, purchase__isnull=False),
                "cashtx_kind_matches_source",
            ),
        ]


class EmergencyHotline(models.Model):
    """Official DRRM emergency hotline shown to residents. Single row (pk=1)."""

    phone_number = models.CharField(max_length=30)
    updated_by = models.CharField(max_length=150, blank=True, default="")
    updated_at = models.DateTimeField(default=timezone.now)


class EmergencyContact(models.Model):
    """Emergency number managed by DRRM and shown to residents in the mobile app."""

    CATEGORY_CHOICES = [
        ("drrm", "DRRM / CDRRMO"),
        ("police", "Police"),
        ("fire", "Fire Department"),
        ("hospital", "Hospital / Medical"),
        ("rescue", "Rescue / Ambulance"),
        ("other", "Other"),
    ]
    name = models.CharField(max_length=100)
    phone_number = models.CharField(max_length=30)
    category = models.CharField(max_length=10, choices=CATEGORY_CHOICES, default="other")
    updated_by = models.CharField(max_length=150, blank=True, default="")
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["category", "name"]
