from django.db import models
from django.contrib.auth.hashers import make_password, check_password
from django.contrib.auth.models import User
from django.utils import timezone
import random


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
    relation = models.CharField(max_length=20, choices=RELATION_CHOICES, default="Other")

    # Vulnerability flags (Step 4)
    is_pwd = models.BooleanField(default=False)
    pwd_detail = models.CharField(max_length=255, blank=True)
    is_pregnant = models.BooleanField(default=False)
    pregnant_detail = models.CharField(max_length=255, blank=True)

    # Used for evacuation-center QR check-in/out (Home screen "My QR Code")
    qr_code = models.CharField(max_length=255, unique=True, blank=True, null=True)

    @property
    def is_elderly(self):
        return self.age >= 60

    @property
    def is_child_under5(self):
        return self.age < 5

    def __str__(self):
        return f"{self.full_name} ({self.relation} of {self.household.full_name})"


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
    donation_date = models.DateField(default=timezone.now)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default="pending")

    class Meta:
        ordering = ["-donation_date"]

    def __str__(self):
        return f"{self.donor_name} — {self.goods_type} x{self.quantity}"


# Relief goods come in only two kinds: "rice" and "pack". A pack holds
# all the other goods (canned goods, noodles, ...), so there is no
# separate storage row for them. Names are matched case-insensitively
# in the views; the label helper below capitalises them for display.
GOODS_TYPES = ("rice", "pack")


def goods_label(value):
    value = (value or "").strip()
    return value[:1].upper() + value[1:]


class GoodsLabelMixin:
    """Gives get_goods_type_display() for the rice / pack goods types."""

    def get_goods_type_display(self):
        return goods_label(self.goods_type)


class ReliefStock(GoodsLabelMixin, models.Model):
    """Simple relief-goods storage: one row per goods type (rice, pack,
    ...), holding the quantity currently on hand. It goes up when goods
    are stored (cswd_add_relief_stock, cswd_add_donation) and down
    whenever a ReliefDistribution record is created
    (cswd_record_relief). There is no separate movement history."""

    goods_type = models.CharField(max_length=100, unique=True)
    quantity = models.PositiveIntegerField(default=0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["goods_type"]

    def __str__(self):
        return f"{self.get_goods_type_display()}: {self.quantity} left"


class ReliefDistribution(GoodsLabelMixin, models.Model):
    """Matches the ERD's relief_distribution entity (household_id,
    disaster_type_id, quantity_given, distribution_date, tracking_number,
    claim_status), with one addition: goods_type, so a release is either
    "rice" or "pack" and can be matched back against ReliefStock. Creating
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
            self.tracking_number = f"RD-{timezone.now().strftime('%Y%m%d%H%M%S')}-{random.randint(100, 999)}"
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