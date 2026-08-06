# GeoAid Resident App

Resident-facing companion to the GeoAid staff dashboards, built with React +
Vite. Styling reuses the same tokens as `GEOAID_frontend` (Segoe UI, navy
brand color, `#2563eb` blue, and the same green/orange/purple accents used
in the staff `dashboard.css` stat cards).

## Where this goes

Your project is at:
```
C:\Users\Admin\GeoAid\GEOAID_backend
C:\Users\Admin\GeoAid\GEOAID_frontend
```

Unzip this as a sibling folder so it lines up with the other two:
```
C:\Users\Admin\GeoAid\GEOAID_resident
```

## Flow

1. **`/register`** — entry point. Step 1 (Account Setup) POSTs to
   `http://127.0.0.1:8000/api/resident/register/`. Steps 2-4 (Household,
   Members, Vulnerability) are placeholder screens with the step-progress
   bar wired up.
2. **`/login`** — mobile-number + password sign-in. POSTs to
   `http://127.0.0.1:8000/api/resident/login/`.
3. **`/home`** — resident dashboard. Fetches
   `http://127.0.0.1:8000/api/resident/dashboard/?mobile_number=...` and
   falls back to mock data if the backend isn't running.

These three endpoints are now real — see the `geoaid-backend-resident-patch`
zip for the `GEOAID_backend` side (Household model + views + urls). Apply
that patch, run `python manage.py migrate`, then `python manage.py
runserver` before starting this app.

## Run it

```
npm install
npm run dev
```
