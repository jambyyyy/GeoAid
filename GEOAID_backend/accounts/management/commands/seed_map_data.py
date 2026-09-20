"""python manage.py seed_map_data

Fills in what the DRRM evacuation map needs that the database was missing:

  1. Barangay coordinates. Creates the Barangay row if it doesn't exist yet,
     otherwise only fills latitude/longitude when they're empty (pass
     --overwrite to replace existing values). Coordinates are the
     approximate barangay centers published by PhilAtlas.
  2. A starter road network. Links every barangay that has coordinates to
     its nearest neighbours (--neighbors, default 2) and then joins any
     leftover isolated clusters, so Dijkstra always has a connected graph.
     Existing RoadSegment rows are never modified.

The auto-generated links are straight lines between barangay centers, NOT
surveyed roads. Review them in Django admin > Road segments: delete links
that don't exist on the ground, add real ones, and enter real distances.

Safe to re-run.
"""

from django.core.management.base import BaseCommand

from ...models import Barangay, RoadSegment
from ...routing import haversine_km

# (canonical name, lowercase aliases already used in your data, lat, lng)
BARANGAYS = [
    ("Mahayahay", ["mahayahay", "mahayhay"], 8.2219, 124.2406),
    ("Tambacan", ["tambacan"], 8.2236, 124.2347),
    ("Abuno", ["abuno"], 8.1846, 124.2571),
    ("Hinaplanon", ["hinaplanon"], 8.2467, 124.2592),
    ("Pala-o Riverside", ["pala-o riverside", "pala-o", "palao"], 8.2286, 124.2532),
    ("Tubod", ["tubod"], 8.2117, 124.2410),
    ("Tipanoy", ["tipanoy"], 8.1902, 124.2634),
]


class Command(BaseCommand):
    help = "Seed barangay coordinates and a starter road network for the DRRM evacuation map."

    def add_arguments(self, parser):
        parser.add_argument("--neighbors", type=int, default=2,
                            help="Link each barangay to its N nearest neighbours (default 2).")
        parser.add_argument("--overwrite", action="store_true",
                            help="Replace coordinates that are already set.")
        parser.add_argument("--skip-roads", action="store_true",
                            help="Only seed barangay coordinates.")

    def handle(self, *args, **opts):
        existing = {b.barangay_name.strip().lower(): b for b in Barangay.objects.all()}

        for name, aliases, lat, lng in BARANGAYS:
            b = next((existing[a] for a in [name.lower(), *aliases] if a in existing), None)
            if b is None:
                b = Barangay.objects.create(barangay_name=name, latitude=lat, longitude=lng)
                existing[name.lower()] = b
                self.stdout.write(self.style.SUCCESS(f"created  {name} ({lat}, {lng})"))
            elif opts["overwrite"] or b.latitude is None or b.longitude is None:
                b.latitude, b.longitude = lat, lng
                b.save(update_fields=["latitude", "longitude"])
                self.stdout.write(f"updated  {b.barangay_name} ({lat}, {lng})")
            else:
                self.stdout.write(f"kept     {b.barangay_name} (already has coordinates)")

        if opts["skip_roads"]:
            return

        located = [b for b in Barangay.objects.all() if None not in (b.latitude, b.longitude)]
        if len(located) < 2:
            self.stdout.write("Need at least two barangays with coordinates to link roads.")
            return

        linked = {frozenset((s.from_barangay_id, s.to_barangay_id)) for s in RoadSegment.objects.all()}
        created = 0

        def link(a, b):
            nonlocal created
            key = frozenset((a.id, b.id))
            if key in linked:
                return
            RoadSegment.objects.create(from_barangay=a, to_barangay=b)  # distance auto-estimated
            linked.add(key)
            created += 1

        def dist(a, b):
            return haversine_km(a.latitude, a.longitude, b.latitude, b.longitude)

        # 1) each barangay -> its N nearest neighbours
        for a in located:
            for b in sorted((x for x in located if x.id != a.id), key=lambda x: dist(a, x))[: max(1, opts["neighbors"])]:
                link(a, b)

        # 2) make sure the network is one connected piece
        parent = {b.id: b.id for b in located}

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for key in linked:
            ids = [i for i in key if i in parent]
            if len(ids) == 2:
                parent[find(ids[0])] = find(ids[1])

        while len({find(b.id) for b in located}) > 1:
            best = min(
                ((a, b) for a in located for b in located if find(a.id) != find(b.id)),
                key=lambda pair: dist(*pair),
            )
            link(*best)
            parent[find(best[0].id)] = find(best[1].id)

        self.stdout.write(self.style.SUCCESS(
            f"Road network: {created} new link(s), {len(linked)} total between {len(located)} barangays."
        ))
        self.stdout.write("Review them in Django admin > Road segments before relying on the routes.")