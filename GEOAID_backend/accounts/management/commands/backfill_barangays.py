from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import Barangay, Household, EvacuationCenter


class Command(BaseCommand):
    help = "Backfill the Barangay table and link existing Household/EvacuationCenter rows to it."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Show what would change without writing anything to the database.",
        )

    def handle(self, *args, **options):
        dry_run = options["dry_run"]

        names = {name for _, name in Household.BARANGAY_CHOICES} if hasattr(Household, "BARANGAY_CHOICES") else set()
        names |= set(
            Household.objects.exclude(barangay="").values_list("barangay", flat=True).distinct()
        )
        names |= set(
            EvacuationCenter.objects.exclude(barangay="").values_list("barangay", flat=True).distinct()
        )
        names.discard("")
        names = sorted(names)

        existing = set(Barangay.objects.values_list("barangay_name", flat=True))
        to_create = [name for name in names if name not in existing]

        self.stdout.write(f"Barangay names found in data/choices: {len(names)}")
        self.stdout.write(f"Already in Barangay table: {len(existing)}")
        self.stdout.write(f"Will create: {len(to_create)} -> {to_create}")

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no Barangay rows created."))
        else:
            with transaction.atomic():
                Barangay.objects.bulk_create([Barangay(barangay_name=n) for n in to_create])
            self.stdout.write(self.style.SUCCESS(f"Created {len(to_create)} Barangay row(s)."))

        barangay_by_name = {b.barangay_name: b for b in Barangay.objects.all()}

        households_to_link = list(
            Household.objects.filter(barangay_fk__isnull=True).exclude(barangay="")
        )
        centers_to_link = list(
            EvacuationCenter.objects.filter(barangay_fk__isnull=True).exclude(barangay="")
        )

        unmatched = set()
        household_updates = []
        for h in households_to_link:
            b = barangay_by_name.get(h.barangay)
            if b:
                h.barangay_fk = b
                household_updates.append(h)
            else:
                unmatched.add(h.barangay)

        center_updates = []
        for c in centers_to_link:
            b = barangay_by_name.get(c.barangay)
            if b:
                c.barangay_fk = b
                center_updates.append(c)
            else:
                unmatched.add(c.barangay)

        self.stdout.write(f"Households to link: {len(household_updates)} / {len(households_to_link)}")
        self.stdout.write(f"Evacuation centers to link: {len(center_updates)} / {len(centers_to_link)}")
        if unmatched:
            self.stdout.write(self.style.WARNING(f"Unmatched barangay names (skipped): {sorted(unmatched)}"))

        if dry_run:
            self.stdout.write(self.style.WARNING("Dry run — no barangay_fk values updated."))
            return

        with transaction.atomic():
            if household_updates:
                Household.objects.bulk_update(household_updates, ["barangay_fk"])
            if center_updates:
                EvacuationCenter.objects.bulk_update(center_updates, ["barangay_fk"])

        self.stdout.write(self.style.SUCCESS(
            f"Linked {len(household_updates)} household(s) and {len(center_updates)} "
            f"evacuation center(s) to their Barangay row."
        ))