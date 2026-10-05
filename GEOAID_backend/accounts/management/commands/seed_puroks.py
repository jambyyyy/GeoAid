from django.core.management.base import BaseCommand

from accounts.models import Barangay, Household, Purok


class Command(BaseCommand):
    help = (
        "Copies the built-in purok list (Household.PUROK_CHOICES_BY_BARANGAY) into the "
        "Purok table and links existing households to their purok. Safe to run repeatedly."
    )

    def handle(self, *args, **options):
        created = 0
        for brgy_name, names in Household.PUROK_CHOICES_BY_BARANGAY.items():
            barangay = Barangay.objects.filter(barangay_name__iexact=brgy_name).first()
            if not barangay:
                self.stdout.write(self.style.WARNING(f"Skipped {brgy_name}: no such Barangay row."))
                continue
            for name in names:
                _, was_created = Purok.objects.get_or_create(barangay=barangay, purok_name=name)
                created += int(was_created)

        linked = 0
        for h in Household.objects.exclude(purok="").iterator():
            row = Purok.match(h.barangay, h.purok)
            if row and h.purok_fk_id != row.id:
                Household.objects.filter(pk=h.pk).update(purok_fk=row)
                linked += 1

        self.stdout.write(self.style.SUCCESS(
            f"Created {created} purok(s); linked {linked} household(s)."
        ))