# GeoAid Relief-Goods Tracking

The CSWD relief module is database-backed. Relief items, stock receipts, household distributions, and inventory movements are persisted in Django models; there is no demo relief inventory or fake distribution list in the CSWD relief UI.

## Data model

- `ReliefItem`: configurable relief good and current stock.
- `ReliefInventoryTransaction`: immutable receipt/distribution audit trail.
- `ReliefDistribution`: one completed household claim, optionally tied to an active `DisasterType`.
- `ReliefDistributionItem`: the goods and quantities included in a claim.

## API

`GET /api/cswd/relief/`

Returns active inventory, distribution history, confirmed households, and active disasters.

`POST /api/cswd/relief/`

The request must include the logged-in CSWD username and one of these actions:

- `create_item`: `{ "name", "unit", "initial_stock" }`
- `receive_stock`: `{ "item_id", "quantity", "reference", "notes" }`
- `record_distribution`: `{ "household_code", "disaster_id", "items": [{ "item_id", "quantity" }], "notes" }`

Distribution writes are atomic and lock inventory rows before deducting stock, so a household claim cannot overdraw available stock.

## Setup

Run:

```bash
cd GEOAID_backend
python manage.py migrate
```

The new migration is `accounts/migrations/0007_relief_tracking.py`.

The frontend reads the API at the existing `API_URL` configuration and provides forms for creating goods, receiving stock, recording household distributions, and reviewing the beneficiary checklist/history.

## Verification

Backend Python files were syntax-checked in this delivery environment. Django runtime tests could not be executed here because Django is not installed in the execution environment and external package installation is unavailable.

## Barangay-side relief claiming

`GET /api/barangay/relief/?username=<barangay_staff_username>` returns the authenticated staff member's barangay-scoped confirmed households, current central relief inventory, active disaster events, and that barangay's distribution history.

`POST /api/barangay/relief/` accepts:

```json
{
  "action": "claim_relief",
  "username": "barangay_staff_username",
  "household_code": "HH-...",
  "disaster_id": 1,
  "items": [{"item_id": 1, "quantity": 1}],
  "notes": "Optional note"
}
```

Barangay staff can only claim for confirmed households assigned to their own barangay. The claim uses the same locked central inventory as CSWD, creates an immutable inventory movement, and prevents a duplicate claim for the same household and selected disaster event.

## CSWD Reporting and Export

`GET /api/cswd/reports/` returns a database-backed CSWD relief report. Optional filters are:

- `start_date=YYYY-MM-DD`
- `end_date=YYYY-MM-DD`
- `barangay=<barangay name>`
- `disaster_id=<DisasterType id>`

The JSON response includes total claims, unique households served, total units distributed, barangay summaries, relief-item summaries, detailed distribution rows, current inventory, and available disaster/barangay filter options.

For spreadsheet-friendly export, add `format=csv` to the same endpoint. The CSV contains one row per distributed relief item with distribution ID, household, barangay, disaster, date, recorder, item, unit, quantity, and notes.

The CSWD frontend Reports section now provides date/barangay/disaster filters, live summary cards, barangay and item breakdowns, distribution detail, and an Export CSV action. All values are loaded from the backend; no relief-report figures are hardcoded.


## CSWD report troubleshooting

The frontend report page calls `http://<frontend-host>:8000/api/cswd/reports/` during Vite development. If the browser shows an HTML response or `Unexpected token '<'`, the frontend is receiving a Django error/404 page instead of JSON.

Use the backend from the same updated project folder and run:

```cmd
cd /d "C:\Users\Admin\GeoAid-master\GEOAID_backend"
python manage.py migrate
python manage.py runserver 8000
```

Then verify this URL in the browser: `http://127.0.0.1:8000/api/cswd/reports/`. It should display JSON, not a Django HTML error page.

If it still returns a 404, the running Django process is not using this updated project copy; stop the old server with `Ctrl+C` and restart it from the folder above.

## Resident dashboard: real nearest evacuation center

`GET /api/resident/dashboard/` (`resident_dashboard` in `accounts/views.py`) no longer
returns a hardcoded "Tibanga Gymnasium" card. `EvacuationCenter` gained `gps_lat`/`gps_lng`
(migration `0008_evacuationcenter_gps_lat_evacuationcenter_gps_lng.py`), and
`_nearest_center_payload()`:

- Computes a real haversine distance/walk-time when both the household and at least one
  `EvacuationCenter` have GPS coordinates set, picking the closest one.
- Falls back to a same-barangay center (no distance shown) when coordinates aren't set yet.
- Falls back further to any center at all if none match the household's barangay.
- Returns `None` if there are zero `EvacuationCenter` rows in the database.

The resident web app (`geoaid-resident/src/pages/home/Home.jsx`) and the mobile app
(`geoaid-mobile/src/screens/HomeScreen.js`) were updated to handle a `null` `nearest_center`
and `null` `distance_km`/`walk_minutes` gracefully instead of assuming they're always present.

Still hardcoded / not yet backed by a real model: the `flood_advisory` flag and `advisory`
body text (needs an `Advisory`/`Disaster` model — see the `TODO`s in `purok_dashboard()` and
`resident_dashboard()`), and `unread_alerts` (no notifications model yet).

## Flood advisories and resident alerts (real models)

`Advisory` (barangay-scoped, or blank barangay for city-wide) and `HouseholdNotification`
replace the two remaining hardcoded strings above:

- `purok_dashboard()`'s `flood_advisory` flag and `resident_dashboard()`'s `advisory` field
  both now query real `Advisory` rows via `_active_advisory_for_barangay()` (a barangay-
  specific advisory takes priority over a city-wide one if both are active).
- Saving a new active `Advisory` in Django admin fires a `post_save` signal
  (`accounts/signals.py`) that creates a `HouseholdNotification` for every `approved`/
  `confirmed` household in its barangay (or every such household city-wide).
- `resident_dashboard()`'s `unread_alerts` now counts each household's unread
  `HouseholdNotification` rows instead of a hardcoded `2`.
- `POST /api/resident/alerts/read/` (`{"mobile_number": "..."}`) marks a household's
  notifications read. The bell icon in both the resident web app and the mobile app now
  calls this on tap and optimistically zeroes the badge.

Migration: `accounts/migrations/0009_household_reviewed_at_advisory_householdnotification.py`.
Manage advisories the same way as `DisasterType` — via Django admin (`Advisory` /
`Household Notifications`, the latter read-only since it's system-generated).

## Purok registration reports

`GET /api/purok/reports/` (scoped the same way as `purok_dashboard()`, by `?username=` or a
`?barangay=`/`?purok=` override) replaces the "not yet available from the dashboard API"
placeholder that used to sit in `PurokDashboard.jsx`'s Reports tab.

Returns, for the last N weeks (`?weeks=`, default 8, max 26):

```json
{
  "purok": "...", "barangay": "...",
  "weeks": [
    {"week_start": "2026-08-24", "week_end": "2026-08-30",
     "approved": 1, "rejected": 0, "registered": 3, "unregistered": 0}
  ],
  "totals": {"approved": 12, "rejected": 2, "pending": 4, "unregistered": 1}
}
```

`approved`/`rejected` per week are bucketed by `Household.reviewed_at` (a new field, set by
`purok_review_household()` whenever a Purok President makes a decision) — not by when the
household originally registered. `registered`/`unregistered` are bucketed by `created_at`.
`PurokDashboard.jsx`'s Reports tab now fetches this lazily (on first click into the tab) and
renders the totals as stat cards plus a weekly table.
