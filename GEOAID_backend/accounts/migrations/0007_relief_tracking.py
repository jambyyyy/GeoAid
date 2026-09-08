# Generated manually for GeoAid relief-goods tracking.
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0006_barangay_disastertype_household_barangay_fk_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="ReliefItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=150, unique=True)),
                ("unit", models.CharField(default="pack", max_length=50)),
                ("stock_on_hand", models.PositiveIntegerField(default=0)),
                ("active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="ReliefDistribution",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("barangay", models.CharField(choices=[("Mahayahay","Mahayahay"),("Tambacan","Tambacan"),("Abuno","Abuno"),("Hinaplanon","Hinaplanon"),("Pala-o Riverside","Pala-o Riverside"),("Tubod","Tubod"),("Tipanoy","Tipanoy")], max_length=50)),
                ("status", models.CharField(choices=[("claimed","Claimed"),("cancelled","Cancelled")], default="claimed", max_length=20)),
                ("distributed_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("recorded_by", models.CharField(blank=True, max_length=150)),
                ("notes", models.CharField(blank=True, max_length=255)),
                ("disaster_type", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="relief_distributions", to="accounts.disastertype")),
                ("household", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="relief_distributions", to="accounts.household")),
            ],
            options={"ordering": ["-distributed_at"]},
        ),
        migrations.CreateModel(
            name="ReliefInventoryTransaction",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("transaction_type", models.CharField(choices=[("receipt","Receipt"),("distribution","Distribution"),("adjustment","Adjustment")], max_length=20)),
                ("quantity", models.IntegerField()),
                ("balance_after", models.PositiveIntegerField()),
                ("reference", models.CharField(blank=True, max_length=100)),
                ("notes", models.CharField(blank=True, max_length=255)),
                ("recorded_by", models.CharField(blank=True, max_length=150)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="transactions", to="accounts.reliefitem")),
            ],
            options={"ordering": ["-created_at"]},
        ),
        migrations.CreateModel(
            name="ReliefDistributionItem",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("quantity", models.PositiveIntegerField()),
                ("distribution", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="items", to="accounts.reliefdistribution")),
                ("relief_item", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="distribution_lines", to="accounts.reliefitem")),
            ],
        ),
        migrations.AddConstraint(
            model_name="reliefdistributionitem",
            constraint=models.UniqueConstraint(fields=("distribution","relief_item"), name="unique_relief_item_per_distribution"),
        ),
    ]
