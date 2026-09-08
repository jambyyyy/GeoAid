from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0003_household_status'),
    ]

    operations = [
        migrations.AlterField(
            model_name='household',
            name='status',
            field=models.CharField(
                choices=[
                    ('pending', 'Pending Review'),
                    ('approved', 'Approved by Purok President'),
                    ('confirmed', 'Confirmed by Barangay Staff'),
                    ('rejected', 'Rejected'),
                ],
                default='pending',
                max_length=10,
            ),
        ),
    ]
