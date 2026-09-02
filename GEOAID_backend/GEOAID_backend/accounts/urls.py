from django.urls import path
from .views import login_user, cswd_dashboard, purok_dashboard

urlpatterns = [
    path('login/', login_user, name='login'),
     path("cswd/dashboard/", cswd_dashboard),
     path("purok/dashboard/", purok_dashboard),
]