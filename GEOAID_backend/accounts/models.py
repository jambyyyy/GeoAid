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

    class Meta:
        verbose_name_plural = "Barangays"

    def __str__(self):
        return self.barangay_name


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
    address_line = models.CharField(max_length=255, blank=True)
    landmark = models.CharField(max_length=255, blank=True)
    dwelling_type = models.CharField(max_length=20, choices=DWELLING_TYPE_CHOICES, blank=True)
    gps_lat = models.FloatField(null=True, blank=True)
    gps_lng = models.FloatField(null=True, blank=True)

    # --- Step 4: Vulnerability Assessment (household-level) ---
    is_four_ps = models.BooleanField(default=False)

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


class Report(models.Model):
    """Matches the ERD's report entity (Table 3.24). Backs the
    "Generate Report" use case shared by CSWD, Barangay Staff, and DRRM
    Officers — each dashboard's Reports tab previously showed either a
    hardcoded fake list or an honest "not available yet" placeholder;
    this replaces both with real, staff-generated records."""

    REPORT_TYPE_CHOICES = [
        ("relief_vulnerability", "Relief & Vulnerability"),
        ("situation", "Situation"),
        ("disaster_monitoring", "Disaster Monitoring"),
    ]

    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports"
    )
    generated_by = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True, related_name="reports"
    )
    report_type = models.CharField(max_length=25, choices=REPORT_TYPE_CHOICES)
    title = models.CharField(max_length=255)
    content = models.TextField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return self.title


class ReliefDistribution(models.Model):
    """Matches the ERD's relief_distribution entity — the beneficiary
    checklist Objective 4 calls for. One row = one relief release event
    to a specific household, logged by CSWD staff from the Relief
    Distribution tab. A household can have several rows over time (e.g.
    relief given for two different disasters), which is why this is its
    own table rather than a single status flag on Household — that was
    the previous placeholder behavior (every confirmed household just
    showed "Registered", see the TODOs this model replaces)."""

    household = models.ForeignKey(
        Household, on_delete=models.CASCADE, related_name="relief_records"
    )
    disaster_type = models.ForeignKey(
        DisasterType, on_delete=models.SET_NULL, null=True, blank=True, related_name="relief_distributions"
    )
    goods_type = models.CharField(max_length=100)
    quantity = models.PositiveIntegerField(default=0)
    # Free-text name/username of the CSWD staffer who logged this — mirrors
    # how the rest of the app identifies staff (sessionStorage "geoaid_user"
    # on the frontend), not a FK to Django's auth User.
    distributed_by = models.CharField(max_length=150, blank=True)
    distributed_at = models.DateTimeField(default=timezone.now)
    remarks = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-distributed_at"]

    def __str__(self):
        return f"{self.household.full_name} — {self.goods_type} x{self.quantity}"