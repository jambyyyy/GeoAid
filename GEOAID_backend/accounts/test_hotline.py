import json
from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.test import TestCase
from .hotline_views import normalize_phone
from .models import EmergencyHotline

class HotlineTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for n, u in (("DRRM Officer", "drrm1"), ("CSWD", "cswd1")):
            g = Group.objects.create(name=n)
            User.objects.create_user(u, password="pw12345!").groups.add(g)
    def setUp(self): cache.clear()
    def post(self, **kw):
        return self.client.post("/api/drrm/emergency-hotline/", json.dumps(kw), content_type="application/json")
    def test_empty_is_null(self):
        self.assertIsNone(self.client.get("/api/resident/emergency-hotline/").json()["phone_number"])
    def test_validation(self):
        for ok in ("09171234567", "+63 917 123 4567", "(088) 123-4567", "02 8123 4567", "911"):
            self.assertIsNotNone(normalize_phone(ok), ok)
        for bad in ("", "abc", "12345", "0917123", "09171234567890", "+1 555 123 4567"):
            self.assertIsNone(normalize_phone(bad), bad)
    def test_save_and_update(self):
        r = self.post(username="drrm1", password="pw12345!", phone_number="0881234567")
        self.assertEqual(r.status_code, 200)
        self.post(username="drrm1", password="pw12345!", phone_number="09171234567")
        self.assertEqual(EmergencyHotline.objects.count(), 1)
        self.assertEqual(self.client.get("/api/resident/emergency-hotline/").json()["phone_number"], "09171234567")
    def test_rejections(self):
        self.assertEqual(self.post(username="drrm1", password="bad", phone_number="09171234567").status_code, 401)
        self.assertEqual(self.post(username="cswd1", password="pw12345!", phone_number="09171234567").status_code, 403)
        self.assertEqual(self.post(username="drrm1", password="pw12345!", phone_number="nope").status_code, 400)
        self.assertEqual(self.post(phone_number="09171234567").status_code, 400)
        self.assertEqual(EmergencyHotline.objects.count(), 0)
    def test_lockout(self):
        for _ in range(5): self.post(username="drrm1", password="x", phone_number="911")
        self.assertEqual(self.post(username="drrm1", password="pw12345!", phone_number="911").status_code, 429)
