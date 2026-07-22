from django.urls import path
from .views import login_user, cswd_dashboard

urlpatterns = [
    path('login/', login_user, name='login'),
     path("cswd/dashboard/", cswd_dashboard),
]