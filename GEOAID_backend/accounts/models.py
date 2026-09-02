from django.db import models
from django.contrib.auth.hashers import make_password, check_password
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

    # Registration is intentionally limited to Iligan City's flood-prone
    # barangays for now (no "Other") — these are the same 7 named in the
    # landing page hero copy and covered by CDRRMO flood advisories.
    BARANGAY_CHOICES = [
        ("Mahayahay", "Mahayahay"),
        ("Tambacan", "Tambacan"),
        ("Abuno", "Abuno"),
        ("Hinaplanon", "Hinaplanon"),
        ("Pala-o Riverside", "Pala-o Riverside"),
        ("Tubod", "Tubod"),
        ("Tipanoy", "Tipanoy"),
    ]

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

    # --- Step 1: Account Setup ---
    household_code = models.CharField(max_length=24, unique=True, editable=False)
    full_name = models.CharField(max_length=150)
    mobile_number = models.CharField(max_length=20, unique=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

    # --- Step 2: Household Setup ---
    barangay = models.CharField(max_length=50, choices=BARANGAY_CHOICES, blank=True)
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
    against Household.BARANGAY_CHOICES."""

    STATUS_CHOICES = [("open", "Open"), ("closed", "Closed")]

    name = models.CharField(max_length=150)
    barangay = models.CharField(max_length=50, choices=Household.BARANGAY_CHOICES)
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