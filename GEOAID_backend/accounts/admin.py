from django.contrib import admin
<<<<<<< HEAD
from .models import (
    Household,
    FamilyMember,
    EvacuationCenter,
    Attendance,
    Barangay,
    DisasterType,
)


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


@admin.register(EvacuationCenter)
class EvacuationCenterAdmin(admin.ModelAdmin):
    list_display = ("name", "barangay", "current_occupancy", "capacity", "status")
    list_filter = ("barangay", "status")
    search_fields = ("name",)


@admin.register(Attendance)
class AttendanceAdmin(admin.ModelAdmin):
    list_display = ("family_member", "household", "evacuation_center", "check_in_time", "check_out_time", "attendance_status")
    list_filter = ("attendance_status", "evacuation_center")
    search_fields = ("family_member__full_name", "household__full_name")
    readonly_fields = ("check_in_time", "check_out_time")


@admin.register(Barangay)
class BarangayAdmin(admin.ModelAdmin):
    list_display = ("barangay_name",)
    search_fields = ("barangay_name",)


@admin.register(DisasterType)
class DisasterTypeAdmin(admin.ModelAdmin):
    list_display = ("disaster_type_name", "start_date", "end_date", "status")
    list_filter = ("status",)
    search_fields = ("disaster_type_name",)
=======

# Register your models here.
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
