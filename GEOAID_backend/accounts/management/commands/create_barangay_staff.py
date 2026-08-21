import secrets

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand

from accounts.models import Household

# The 7 flood-prone barangays GeoAid covers (same list as the landing
# page hero copy and Household.BARANGAY_CHOICES, minus "Other").
PRONE_BARANGAYS = [
    name for name, _label in Household.BARANGAY_CHOICES if name != "Other"
]

GROUP_NAME = "Barangay Staff"


def username_for(barangay):
    """'Pala-o Riverside' -> 'barangay_palao_riverside'"""
    slug = (
        barangay.lower()
        .replace("-", "")
        .replace(" ", "_")
    )
    return f"barangay_{slug}"


class Command(BaseCommand):
    help = (
        "Creates one Barangay Staff login (Django User in the "
        "'Barangay Staff' group) for each flood-prone barangay. "
        "Idempotent: re-running skips accounts that already exist "
        "unless --reset is passed. First Name is set to the barangay "
        "name, which is how login_user()/barangay_dashboard() scope "
        "that account to its own barangay."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Regenerate passwords for accounts that already exist.",
        )
        parser.add_argument(
            "--password",
            default=None,
            help=(
                "Use this exact password for every account instead of a "
                "random one (handy for local/demo setups). Not recommended "
                "for anything real staff will actually use."
            ),
        )

    def handle(self, *args, **options):
        group, _ = Group.objects.get_or_create(name=GROUP_NAME)

        rows = []
        for barangay in PRONE_BARANGAYS:
            username = username_for(barangay)
            user, created = User.objects.get_or_create(
                username=username,
                defaults={"first_name": barangay, "is_active": True},
            )

            if not created and user.first_name != barangay:
                user.first_name = barangay
                user.save(update_fields=["first_name"])

            group.user_set.add(user)

            if created or options["reset"]:
                password = options["password"] or secrets.token_urlsafe(9)
                user.set_password(password)
                user.save(update_fields=["password"])
                rows.append((barangay, username, password, "created" if created else "reset"))
            else:
                rows.append((barangay, username, "(unchanged — already exists)", "existing"))

        self.stdout.write("")
        self.stdout.write(f"{'Barangay':<20} {'Username':<28} {'Password':<20} Status")
        self.stdout.write("-" * 90)
        for barangay, username, password, status in rows:
            self.stdout.write(f"{barangay:<20} {username:<28} {password:<20} {status}")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING(
            "Save these credentials now — plaintext passwords are only shown "
            "once, at creation/reset time, and are never stored or logged."
        ))
        self.stdout.write(self.style.SUCCESS(
            f"Done. {sum(1 for r in rows if r[3] != 'existing')} account(s) "
            f"created/reset, {sum(1 for r in rows if r[3] == 'existing')} already existed."
        ))
