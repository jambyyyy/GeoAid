from django.contrib import admin
from .models import (
    Household,
    FamilyMember,
    EvacuationCenter,
    Attendance,
    Barangay,
    DisasterType,
    Advisory,
    HouseholdNotification,
    ReliefItem, ReliefInventoryTransaction, ReliefDistribution, ReliefDistributionItem,
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


@admin.register(Advisory)
class AdvisoryAdmin(admin.ModelAdmin):
    list_display = ("title", "barangay", "is_active", "issued_at")
    list_filter = ("barangay", "is_active")
    search_fields = ("title", "body")


@admin.register(HouseholdNotification)
class HouseholdNotificationAdmin(admin.ModelAdmin):
    list_display = ("household", "title", "is_read", "created_at")
    list_filter = ("is_read",)
    search_fields = ("household__household_code", "household__full_name", "title")
    readonly_fields = ("household", "advisory", "title", "body", "created_at")

@admin.register(ReliefItem)
class ReliefItemAdmin(admin.ModelAdmin):
    list_display = ("name", "unit", "stock_on_hand", "active", "updated_at")
    list_filter = ("active",)
    search_fields = ("name",)


@admin.register(ReliefInventoryTransaction)
class ReliefInventoryTransactionAdmin(admin.ModelAdmin):
    list_display = ("item", "transaction_type", "quantity", "balance_after", "recorded_by", "created_at")
    list_filter = ("transaction_type", "item")
    search_fields = ("item__name", "recorded_by", "reference")
    readonly_fields = ("created_at",)


@admin.register(ReliefDistribution)
class ReliefDistributionAdmin(admin.ModelAdmin):
    list_display = ("household", "barangay", "status", "distributed_at", "recorded_by")
    list_filter = ("barangay", "status", "disaster_type")
    search_fields = ("household__household_code", "household__full_name", "recorded_by")
    readonly_fields = ("distributed_at",)


@admin.register(ReliefDistributionItem)
class ReliefDistributionItemAdmin(admin.ModelAdmin):
    list_display = ("distribution", "relief_item", "quantity")
    list_filter = ("relief_item",)
