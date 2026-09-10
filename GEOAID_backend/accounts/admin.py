from django import forms
from django.contrib import admin
from .models import (
    Household,
    FamilyMember,
    EvacuationCenter,
    Attendance,
    Barangay,
    DisasterType,
    Donation,
    ReliefDistribution,
)


def _barangay_choices():
    """Built fresh from the Barangay table each time a form renders, so
    admin dropdowns for `barangay` always reflect what's actually in
    Django admin > Barangays — no hardcoded list to keep in sync."""
    return [("", "---------")] + [
        (name, name) for name in Barangay.objects.order_by("barangay_name").values_list("barangay_name", flat=True)
    ]


class FamilyMemberInline(admin.TabularInline):
    model = FamilyMember
    extra = 0


class HouseholdAdminForm(forms.ModelForm):
    barangay = forms.ChoiceField(choices=_barangay_choices, required=False)

    class Meta:
        model = Household
        fields = "__all__"


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    form = HouseholdAdminForm
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


class EvacuationCenterAdminForm(forms.ModelForm):
    barangay = forms.ChoiceField(choices=_barangay_choices, required=True)

    class Meta:
        model = EvacuationCenter
        fields = "__all__"


@admin.register(EvacuationCenter)
class EvacuationCenterAdmin(admin.ModelAdmin):
    form = EvacuationCenterAdminForm
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


@admin.register(Donation)
class DonationAdmin(admin.ModelAdmin):
    list_display = ("donor_name", "goods_type", "quantity", "donation_date", "disaster_type", "status")
    list_filter = ("status", "disaster_type")
    search_fields = ("donor_name", "contact_num", "goods_type")


@admin.register(ReliefDistribution)
class ReliefDistributionAdmin(admin.ModelAdmin):
    list_display = ("household", "goods_type", "quantity", "distributed_by", "distributed_at", "disaster_type")
    list_filter = ("disaster_type",)
    search_fields = ("household__full_name", "household__household_code", "goods_type", "distributed_by")