from django.urls import path
<<<<<<< HEAD
from .views import (
    login_user,
    cswd_dashboard,
    drrm_dashboard,
    barangay_dashboard,
    barangay_confirm_household,
    barangay_evacuation_dashboard,
    attendance_scan,
    purok_dashboard,
    purok_review_household,
    register_resident,
    register_complete,
    register_lookups,
    login_resident,
    resident_dashboard,
)

urlpatterns = [
    path('login/', login_user, name='login'),
    path("cswd/dashboard/", cswd_dashboard),
    path("drrm/dashboard/", drrm_dashboard),
    path("barangay/dashboard/", barangay_dashboard),
    path("barangay/households/<str:household_code>/confirm/", barangay_confirm_household),
    path("barangay/evacuation/dashboard/", barangay_evacuation_dashboard),
    path("barangay/attendance/scan/", attendance_scan),
    path("purok/dashboard/", purok_dashboard),
    path("purok/households/<str:household_code>/review/", purok_review_household),

    # Resident app (GEOAID_resident)
    path("resident/register/", register_resident),
    path("resident/register/lookups/", register_lookups),
    path("resident/register/complete/", register_complete),
    path("resident/login/", login_resident),
    path("resident/dashboard/", resident_dashboard),
=======
from .views import login_user, cswd_dashboard, purok_dashboard

urlpatterns = [
    path('login/', login_user, name='login'),
     path("cswd/dashboard/", cswd_dashboard),
     path("purok/dashboard/", purok_dashboard),
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
]