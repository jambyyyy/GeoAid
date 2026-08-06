from django.contrib import admin
from .models import Household


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    list_display = ("household_code", "full_name", "mobile_number", "created_at")
    search_fields = ("household_code", "full_name", "mobile_number")
    readonly_fields = ("household_code", "password_hash", "created_at")
