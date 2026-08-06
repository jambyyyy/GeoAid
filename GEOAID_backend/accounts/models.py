from django.db import models
from django.contrib.auth.hashers import make_password, check_password
from django.utils import timezone
import random


class Household(models.Model):
    """A resident account created through the GeoAid Resident app's
    registration flow (Account Setup step). This is intentionally
    separate from the staff `User`/Group accounts used in login_user —
    residents sign in with a mobile number + password, not a username,
    and don't need Django's admin/permissions machinery."""

    household_code = models.CharField(max_length=24, unique=True, editable=False)
    full_name = models.CharField(max_length=150)
    mobile_number = models.CharField(max_length=20, unique=True)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

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
