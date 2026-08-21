import re
from collections import defaultdict

from django.contrib.auth.models import Group, User
from django.core.management.base import BaseCommand

from accounts.models import Household

GROUP_NAME = "Purok President"


def barangay_slug(barangay):
    """'Pala-o Riverside' -> 'palao_riverside'. Derived from the barangay
    name itself (Household.BARANGAY_CHOICES) — nothing hand-mapped, so a
    barangay renamed/added there is picked up automatically."""
    cleaned = barangay.replace("-", "")
    cleaned = re.sub(r"[^\w\s]", "", cleaned).strip().lower()
    return re.sub(r"\s+", "_", cleaned)


def purok_slug(purok):
    """Derives a short slug straight from the purok/zone name itself
    (Household.PUROK_CHOICES_BY_BARANGAY) instead of a hand-maintained
    lookup table, so new puroks added there get a username automatically:

    - Drops a parenthetical or "/ Alt Name" suffix:
      'Purok 6 (Malindawag)' -> 'Purok 6', 'Zone 7 / Purok 6' -> 'Zone 7'
    - If the name contains "Purok <x>" or "Zone <x>", keeps just that:
      'Riverside Zone 1' -> 'zone_1', 'Purok Green Valley' -> 'purok_green'
    - Otherwise falls back to the first two words: 'Bayug Island' -> 'bayug_island'
    """
    primary = re.split(r"\s*[\(/]", purok)[0].strip()
    cleaned = primary.replace("-", "")
    cleaned = re.sub(r"[^\w\s]", "", cleaned).strip().lower()

    match = re.search(r"\b(purok|zone)\s+(\S+)", cleaned)
    if match:
        prefix, token = match.groups()
        return f"{prefix}_{token}"

    words = cleaned.split()
    return "_".join(words[:2]) if words else "purok"


def build_usernames(puroks_by_barangay):
    """Returns {(barangay, purok): username}, auto-generated from
    Household.PUROK_CHOICES_BY_BARANGAY and de-duplicated by appending
    _2, _3, ... in the rare case two puroks in the same barangay slug
    down to the same short name."""
    usernames = {}
    seen_counts = defaultdict(int)

    for barangay, puroks in puroks_by_barangay.items():
        b_slug = barangay_slug(barangay)
        for purok in puroks:
            base = f"{purok_slug(purok)}_{b_slug}"
            seen_counts[base] += 1
            username = base if seen_counts[base] == 1 else f"{base}_{seen_counts[base]}"
            usernames[(barangay, purok)] = username

    return usernames


# Old naming scheme (purok_<full_barangay>_<full_purok>), kept only so
# the command can rename any account created before usernames were
# shortened, instead of leaving an orphaned duplicate behind.
def _legacy_slug(value):
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower())
    return slug.strip("_")


def legacy_username_for(barangay, purok):
    return f"purok_{_legacy_slug(barangay)}_{_legacy_slug(purok)}"


class Command(BaseCommand):
    help = (
        "Creates one Purok President login (Django User in the "
        "'Purok President' group) for every purok/zone listed under each "
        "barangay in Household.PUROK_CHOICES_BY_BARANGAY — that model is "
        "the single source of truth; usernames are derived from it "
        "algorithmically (see purok_slug/barangay_slug below), not from a "
        "hand-maintained list, so adding a new barangay or purok there is "
        "all that's needed for this command to pick it up next run. "
        "First Name is set to the barangay and Last Name to the purok/zone "
        "— that's how purok_dashboard()/purok_review_household() in "
        "accounts/views.py scope each account to only the households "
        "submitted in their own purok, which then get forwarded to "
        "Barangay Staff once approved. Idempotent: re-running skips "
        "accounts that already exist unless --reset is passed. Also "
        "renames any account still on the old, longer username scheme."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Regenerate passwords for accounts that already exist.",
        )
        parser.add_argument(
            "--password",
            default="purokpres123",
            help=(
                "Use this exact password for every account (defaults to "
                "'purokpres123' for local/demo setups). Not recommended "
                "for anything real Purok Presidents will actually use — "
                "pass a stronger --password before this touches real data."
            ),
        )
        parser.add_argument(
            "--barangay",
            default=None,
            help="Only create accounts for this barangay (e.g. 'Tubod').",
        )

    def handle(self, *args, **options):
        group, _ = Group.objects.get_or_create(name=GROUP_NAME)

        barangay_filter = options["barangay"]
        puroks_by_barangay = Household.PUROK_CHOICES_BY_BARANGAY
        if barangay_filter:
            if barangay_filter not in puroks_by_barangay:
                self.stderr.write(self.style.ERROR(
                    f"Unknown barangay {barangay_filter!r}. Choices: "
                    f"{', '.join(puroks_by_barangay)}"
                ))
                return
            puroks_by_barangay = {barangay_filter: puroks_by_barangay[barangay_filter]}

        usernames = build_usernames(puroks_by_barangay)

        rows = []
        for barangay, puroks in puroks_by_barangay.items():
            for purok in puroks:
                username = usernames[(barangay, purok)]
                legacy_username = legacy_username_for(barangay, purok)

                # Rename an old-scheme account in place if one exists,
                # instead of creating a duplicate under the new username.
                renamed = False
                if not User.objects.filter(username=username).exists():
                    try:
                        legacy_user = User.objects.get(username=legacy_username)
                        legacy_user.username = username
                        legacy_user.save(update_fields=["username"])
                        renamed = True
                    except User.DoesNotExist:
                        pass

                user, created = User.objects.get_or_create(
                    username=username,
                    defaults={
                        "first_name": barangay,
                        "last_name": purok,
                        "is_active": True,
                    },
                )

                update_fields = []
                if not created:
                    if user.first_name != barangay:
                        user.first_name = barangay
                        update_fields.append("first_name")
                    if user.last_name != purok:
                        user.last_name = purok
                        update_fields.append("last_name")
                    if update_fields:
                        user.save(update_fields=update_fields)

                group.user_set.add(user)

                if created or options["reset"]:
                    password = options["password"]
                    user.set_password(password)
                    user.save(update_fields=["password"])
                    status = "created" if created else "reset"
                    rows.append((barangay, purok, username, password, status))
                elif renamed:
                    rows.append((barangay, purok, username, "(unchanged — renamed from old username)", "renamed"))
                else:
                    rows.append((barangay, purok, username, "(unchanged — already exists)", "existing"))

        self.stdout.write("")
        self.stdout.write(f"{'Barangay':<20} {'Purok / Zone':<28} {'Username':<28} {'Password':<20} Status")
        self.stdout.write("-" * 118)
        for barangay, purok, username, password, status in rows:
            self.stdout.write(f"{barangay:<20} {purok:<28} {username:<28} {password:<20} {status}")
        self.stdout.write("")
        self.stdout.write(self.style.WARNING(
            "Save these credentials now — plaintext passwords are only shown "
            "once, at creation/reset time, and are never stored or logged."
        ))
        self.stdout.write(self.style.SUCCESS(
            f"Done. {sum(1 for r in rows if r[4] in ('created', 'reset'))} account(s) "
            f"created/reset, {sum(1 for r in rows if r[4] == 'renamed')} renamed, "
            f"{sum(1 for r in rows if r[4] == 'existing')} already existed."
        ))
