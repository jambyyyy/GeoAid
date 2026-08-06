from django.urls import path
from .views import (
    login_user,
    cswd_dashboard,
    purok_dashboard,
    register_resident,
    login_resident,
    resident_dashboard,
)

urlpatterns = [
    path('login/', login_user, name='login'),
    path("cswd/dashboard/", cswd_dashboard),
    path("purok/dashboard/", purok_dashboard),

    # Resident app (GEOAID_resident)
    path("resident/register/", register_resident),
    path("resident/login/", login_resident),
    path("resident/dashboard/", resident_dashboard),
]
