import json

from django import forms
from django.contrib import admin
from django.utils.safestring import mark_safe
from .models import (
    Household,
    FamilyMember,
    EvacuationCenter,
    Attendance,
    Barangay,
    DisasterType,
    Donation,
    EvacuationRoute,
    VulnerabilityProfile,
    Purok,
    Report,
    ReliefStock,
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


class PurokSelect(forms.Select):
    """A purok dropdown that only lists the puroks of the barangay picked
    in the Barangay dropdown right above it. Changing the barangay
    rebuilds this list on the page, no reload needed."""

    def render(self, name, value, attrs=None, renderer=None):
        html = super().render(name, value, attrs, renderer)
        select_id = (attrs or {}).get("id") or f"id_{name}"
        data = json.dumps(Purok.options())
        script = """
<script>
(function () {
  var puroks = %s;
  var purok = document.getElementById(%s);
  var brgy = document.getElementById("id_barangay");
  if (!purok || !brgy) return;
  function fill() {
    var current = purok.value;
    var names = puroks[brgy.value] || [];
    purok.innerHTML = "";
    var blank = document.createElement("option");
    blank.value = ""; blank.textContent = brgy.value ? "---------" : "Select a barangay first";
    purok.appendChild(blank);
    names.forEach(function (n) {
      var o = document.createElement("option");
      o.value = n; o.textContent = n;
      if (n === current) o.selected = true;
      purok.appendChild(o);
    });
    // keep an existing value that is not in the list (older free-text entries)
    if (current && names.indexOf(current) === -1) {
      var o = document.createElement("option");
      o.value = current; o.textContent = current + " (not in this barangay's list)";
      o.selected = true;
      purok.appendChild(o);
    }
  }
  brgy.addEventListener("change", fill);
  fill();
})();
</script>""" % (data, json.dumps(select_id))
        return mark_safe(html + script)


def _all_purok_choices():
    names = sorted({n for lst in Purok.options().values() for n in lst})
    return [("", "---------")] + [(n, n) for n in names]


class HouseholdAdminForm(forms.ModelForm):
    barangay = forms.ChoiceField(choices=_barangay_choices, required=False)
    purok = forms.ChoiceField(choices=_all_purok_choices, required=False, widget=PurokSelect)

    class Meta:
        model = Household
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # An older household may hold a purok name that is not in the list
        # (it was free text); keep it selectable so editing never loses it.
        current = getattr(self.instance, "purok", "")
        if current:
            existing = [c[0] for c in self.fields["purok"].choices]
            if current not in existing:
                self.fields["purok"].choices = list(self.fields["purok"].choices) + [(current, current)]

    def clean(self):
        cleaned = super().clean()
        barangay, purok = cleaned.get("barangay"), cleaned.get("purok")
        if barangay and purok and purok != getattr(self.instance, "purok", None):
            if purok not in Purok.options().get(barangay, []):
                self.add_error("purok", f"'{purok}' is not a purok of {barangay}.")
        return cleaned


@admin.register(Household)
class HouseholdAdmin(admin.ModelAdmin):
    form = HouseholdAdminForm
    list_display = ("household_code", "full_name", "mobile_number", "barangay", "registration_complete", "created_at")
    list_filter = ("barangay", "dwelling_type", "registration_complete")
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
    list_display = ("name", "barangay", "current_occupancy", "capacity", "status", "latitude", "longitude")
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
    list_display = ("barangay_name", "latitude", "longitude")
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

@admin.register(EvacuationRoute)
class EvacuationRouteAdmin(admin.ModelAdmin):
    list_display = ("start_location", "evacuation_center", "road_condition", "route_status", "created_at")
    list_filter = ("road_condition", "route_status", "evacuation_center__barangay")
    search_fields = ("start_location", "evacuation_center__name")
    readonly_fields = ("created_at",)


@admin.register(VulnerabilityProfile)
class VulnerabilityProfileAdmin(admin.ModelAdmin):
    list_display = ("household", "priority_level", "priority_score", "flags", "family_member", "disaster_type", "updated_at")
    list_filter = ("priority_level", "disaster_type")
    search_fields = ("household__household_code", "household__full_name")
    readonly_fields = ("updated_at",)


@admin.register(Purok)
class PurokAdmin(admin.ModelAdmin):
    list_display = ("purok_name", "barangay", "household_count", "route_distance", "estimated_time", "latitude", "longitude")
    list_filter = ("barangay",)
    search_fields = ("purok_name", "barangay__barangay_name")

    @admin.display(description="Households")
    def household_count(self, obj):
        return obj.households.count()


@admin.register(Report)
class ReportAdmin(admin.ModelAdmin):
    list_display = ("title", "user", "disaster_type", "created_at")
    list_filter = ("disaster_type",)
    search_fields = ("title", "content")
    readonly_fields = ("created_at",)


@admin.register(ReliefStock)
class ReliefStockAdmin(admin.ModelAdmin):
    list_display = ("goods_type", "quantity", "updated_at")
    search_fields = ("goods_type",)
    readonly_fields = ("updated_at",)


@admin.register(ReliefDistribution)
class ReliefDistributionAdmin(admin.ModelAdmin):
    list_display = (
        "tracking_number", "barangay", "household", "evacuation_center",
        "goods_type", "quantity_given", "claim_status", "distribution_date",
    )
    list_filter = ("claim_status", "barangay", "disaster_type")
    search_fields = ("tracking_number", "household__household_code", "household__full_name")