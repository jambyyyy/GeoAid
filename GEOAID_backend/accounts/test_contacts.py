import json
from django.contrib.auth.models import Group, User
from django.core.cache import cache
from django.test import TestCase
from .models import EmergencyContact

class ContactTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        for n, u in (("DRRM Officer", "drrm1"), ("CSWD", "cswd1")):
            User.objects.create_user(u, password="pw12345!").groups.add(Group.objects.create(name=n))
    def setUp(self):
        cache.clear()
        self.tok = self.unlock("drrm1").json()["token"]
    def unlock(self, u, p="pw12345!"):
        return self.client.post("/api/drrm/emergency-contacts/unlock/", json.dumps({"username": u, "password": p}), content_type="application/json")
    def manage(self, tok=None, **kw):
        h = {"HTTP_AUTHORIZATION": f"Bearer {tok or self.tok}"}
        return self.client.post("/api/drrm/emergency-contacts/manage/", json.dumps(kw), content_type="application/json", **h)
    def test_add_list_update_delete(self):
        r = self.manage(action="add", name="Iligan Police", phone_number="(088) 221-1234", category="police")
        self.assertEqual(r.status_code, 200)
        cid = r.json()["contact"]["id"]
        got = self.client.get("/api/resident/emergency-contacts/?mobile_number=x").json()["contacts"]
        self.assertEqual([(c["name"], c["phone"], c["type"]) for c in got], [("Iligan Police", "0882211234", "emergency")])
        self.assertEqual(self.manage(action="update", id=cid, name="Iligan Police", phone_number="911", category="police").status_code, 200)
        self.assertEqual(EmergencyContact.objects.get(pk=cid).phone_number, "911")
        self.assertEqual(self.manage(action="delete", id=cid).status_code, 200)
        self.assertEqual(EmergencyContact.objects.count(), 0)
    def test_validation_and_duplicates(self):
        ok = dict(action="add", name="BFP Iligan", phone_number="09171234567", category="fire")
        self.assertEqual(self.manage(**ok).status_code, 200)
        self.assertEqual(self.manage(**ok).status_code, 400)  # duplicate name
        self.assertEqual(self.manage(**dict(ok, name="X", phone_number="abc")).status_code, 400)
        self.assertEqual(self.manage(**dict(ok, name="", phone_number="911")).status_code, 400)
        self.assertEqual(self.manage(**dict(ok, name="Y", category="bogus")).status_code, 400)
        self.assertEqual(EmergencyContact.objects.count(), 1)
    def test_auth(self):
        self.assertEqual(self.unlock("cswd1").status_code, 403)
        self.assertEqual(self.unlock("drrm1", "bad").status_code, 401)
        r = self.client.post("/api/drrm/emergency-contacts/manage/", json.dumps(dict(action="add", name="A", phone_number="911", category="other")), content_type="application/json")
        self.assertEqual(r.status_code, 401)
        self.assertEqual(self.manage(tok="garbage", action="delete", id=1).status_code, 401)
        self.assertEqual(self.client.get("/api/resident/emergency-contacts/").status_code, 200)

    def test_every_category_saves(self):
        for i, cat in enumerate(("drrm", "police", "fire", "hospital", "rescue", "other")):
            r = self.manage(action="add", name=f"Contact {i}", phone_number="911", category=cat)
            self.assertEqual(r.status_code, 200, (cat, r.content))
