from django.contrib.auth.models import Group, User
from django.test import TestCase

from .models import Household, ReliefItem, ReliefDistribution


class ReliefTrackingTests(TestCase):
    def setUp(self):
        group = Group.objects.create(name="CSWD")
        self.user = User.objects.create_user(username="cswd-test", password="test-password")
        self.user.groups.add(group)
        self.household = Household.objects.create(
            full_name="Test Family",
            mobile_number="09170000000",
            password_hash="unused",
            barangay="Tubod",
            purok="Purok Test",
            registration_complete=True,
            status="confirmed",
        )

    def test_create_item_and_receive_stock_are_database_backed(self):
        response = self.client.post(
            "/api/cswd/relief/",
            data={
                "username": self.user.username,
                "action": "create_item",
                "name": "Rice",
                "unit": "pack",
                "initial_stock": 10,
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 201)
        item = ReliefItem.objects.get(name="Rice")
        self.assertEqual(item.stock_on_hand, 10)

        response = self.client.post(
            "/api/cswd/relief/",
            data={
                "username": self.user.username,
                "action": "receive_stock",
                "item_id": item.id,
                "quantity": 5,
                "reference": "DELIVERY-1",
            },
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.stock_on_hand, 15)

    def test_distribution_deducts_stock_and_creates_audit_record(self):
        item = ReliefItem.objects.create(name="Water", unit="bottle", stock_on_hand=20)

        response = self.client.post(
            "/api/cswd/relief/",
            data={
                "username": self.user.username,
                "action": "record_distribution",
                "household_code": self.household.household_code,
                "items": [{"item_id": item.id, "quantity": 3}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        item.refresh_from_db()
        self.assertEqual(item.stock_on_hand, 17)
        self.assertEqual(ReliefDistribution.objects.count(), 1)

    def test_distribution_cannot_overdraw_stock(self):
        item = ReliefItem.objects.create(name="Blanket", unit="piece", stock_on_hand=2)

        response = self.client.post(
            "/api/cswd/relief/",
            data={
                "username": self.user.username,
                "action": "record_distribution",
                "household_code": self.household.household_code,
                "items": [{"item_id": item.id, "quantity": 3}],
            },
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 409)
        item.refresh_from_db()
        self.assertEqual(item.stock_on_hand, 2)
        self.assertEqual(ReliefDistribution.objects.count(), 0)
