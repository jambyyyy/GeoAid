from django.contrib import admin
from .models import Household, FamilyMember


class FamilyMemberInline(admin.TabularInline):
    model = FamilyMember
    extra = 0


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    list_display = ("household_code", "full_name", "mobile_number", "barangay", "registration_complete", "created_at")
    list_filter = ("barangay", "dwelling_type", "is_four_ps", "registration_complete")
    search_fields = ("household_code", "full_name", "mobile_number")
    readonly_fields = ("household_code", "password_hash", "created_at")
    inlines = [FamilyMemberInline]


@admin.register(FamilyMember)
class FamilyMemberAdmin(admin.ModelAdmin):
    list_display = ("full_name", "household", "relation", "age", "is_pwd", "is_pregnant")
    list_filter = ("relation", "is_pwd", "is_pregnant")
    search_fields = ("full_name", "household__full_name")