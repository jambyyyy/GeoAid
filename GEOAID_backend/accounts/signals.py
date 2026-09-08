from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import Advisory, Household, HouseholdNotification


@receiver(post_save, sender=Advisory)
def notify_households_of_advisory(sender, instance, created, **kwargs):
    """When a new, active Advisory is saved, create a HouseholdNotification
    for every household it applies to, so resident_dashboard()'s
    unread_alerts count reflects something a resident can actually act on.

    Only fires on creation (not every edit) so re-saving an Advisory in
    admin (e.g. to fix a typo) doesn't spam households with duplicate
    alerts. Only reaches households whose registration has actually been
    reviewed — matches the same ("approved", "confirmed") gate that
    resident_dashboard() uses to let a household in at all.
    """
    if not created or not instance.is_active:
        return

    households = Household.objects.filter(status__in=("approved", "confirmed"))
    if instance.barangay:
        households = households.filter(barangay__iexact=instance.barangay)

    HouseholdNotification.objects.bulk_create([
        HouseholdNotification(
            household=household,
            advisory=instance,
            title=instance.title,
            body=instance.body,
        )
        for household in households
    ])
