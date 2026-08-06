import { useEffect, useState } from "react";
import "./HouseholdStep.css";

const FALLBACK_BARANGAYS = [
  "Mahayahay",
  "Tambacan",
  "Abuno",
  "Hinaplanon",
  "Pala-o Riverside",
  "Tubod",
  "Tipanoy",
];

const FALLBACK_DWELLING_TYPES = [
  { value: "concrete", label: "Concrete" },
  { value: "semi_concrete", label: "Semi-concrete" },
  { value: "wood", label: "Wood / Light materials" },
  { value: "makeshift", label: "Makeshift / Informal settler structure" },
];

function PinIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 22s7-6.2 7-12a7 7 0 10-14 0c0 5.8 7 12 7 12Z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function HouseholdStep({ initialValue, onContinue }) {
  const [barangays, setBarangays] = useState(FALLBACK_BARANGAYS);
  const [dwellingTypes, setDwellingTypes] = useState(FALLBACK_DWELLING_TYPES);

  const [barangay, setBarangay] = useState(initialValue?.barangay || "");
  const [purok, setPurok] = useState(initialValue?.purok || "");
  const [addressLine, setAddressLine] = useState(initialValue?.addressLine || "");
  const [landmark, setLandmark] = useState(initialValue?.landmark || "");
  const [dwellingType, setDwellingType] = useState(initialValue?.dwellingType || "");
  const [gps, setGps] = useState(
    initialValue?.gpsLat && initialValue?.gpsLng
      ? { lat: initialValue.gpsLat, lng: initialValue.gpsLng }
      : null
  );
  const [gpsStatus, setGpsStatus] = useState("idle"); // idle | locating | done | error
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/resident/register/lookups/")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.barangays?.length) setBarangays(data.barangays);
        if (data?.dwelling_types?.length) setDwellingTypes(data.dwelling_types);
      })
      .catch(() => {
        // Backend not reachable yet — the fallback lists above keep the
        // form usable while offline/dev server is starting up.
      });
  }, []);

  const pinLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus("error");
      setError("Location services aren't available on this device/browser.");
      return;
    }

    setGpsStatus("locating");
    setError("");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({
          lat: Number(position.coords.latitude.toFixed(6)),
          lng: Number(position.coords.longitude.toFixed(6)),
        });
        setGpsStatus("done");
      },
      () => {
        setGpsStatus("error");
        setError("Couldn't get your location. You can still continue and pin it later.");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    setError("");

    if (!barangay) {
      setError("Please select your barangay.");
      return;
    }
    if (!purok.trim()) {
      setError("Please enter your Purok/Zone.");
      return;
    }
    if (!addressLine.trim()) {
      setError("Please enter your house no. / street address.");
      return;
    }
    if (!dwellingType) {
      setError("Please select your dwelling type.");
      return;
    }

    onContinue({
      barangay,
      purok: purok.trim(),
      addressLine: addressLine.trim(),
      landmark: landmark.trim(),
      dwellingType,
      gpsLat: gps?.lat ?? null,
      gpsLng: gps?.lng ?? null,
    });
  };

  return (
    <form className="household-step" onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}

      <label htmlFor="barangay">Barangay</label>
      <select id="barangay" value={barangay} onChange={(e) => setBarangay(e.target.value)}>
        <option value="">Select barangay</option>
        {barangays.map((b) => (
          <option key={b} value={b}>{b}</option>
        ))}
        <option value="Other">Other</option>
      </select>

      <label htmlFor="purok">Purok / Zone</label>
      <input
        id="purok"
        type="text"
        placeholder="e.g. Purok 3"
        value={purok}
        onChange={(e) => setPurok(e.target.value)}
      />

      <label htmlFor="addressLine">House No. / Street</label>
      <input
        id="addressLine"
        type="text"
        placeholder="e.g. 12 Mabuhay St."
        value={addressLine}
        onChange={(e) => setAddressLine(e.target.value)}
      />

      <label htmlFor="landmark">Nearest Landmark (optional)</label>
      <input
        id="landmark"
        type="text"
        placeholder="e.g. Beside the chapel"
        value={landmark}
        onChange={(e) => setLandmark(e.target.value)}
      />

      <label htmlFor="dwellingType">Dwelling Type</label>
      <select id="dwellingType" value={dwellingType} onChange={(e) => setDwellingType(e.target.value)}>
        <option value="">Select dwelling type</option>
        {dwellingTypes.map((d) => (
          <option key={d.value} value={d.value}>{d.label}</option>
        ))}
      </select>

      <label>GPS Pin</label>
      <button
        type="button"
        className={`pin-btn ${gpsStatus === "done" ? "pinned" : ""}`}
        onClick={pinLocation}
        disabled={gpsStatus === "locating"}
      >
        <PinIcon />
        {gpsStatus === "locating" && "Locating..."}
        {gpsStatus === "done" && `Pinned · ${gps.lat}, ${gps.lng}`}
        {(gpsStatus === "idle" || gpsStatus === "error") && "Use My Current Location"}
      </button>
      <p className="gps-hint">
        Pinning your location helps responders find your household faster during evacuation. You
        can skip this and continue if GPS isn't available right now.
      </p>

      <button type="submit" className="continue-btn">
        Next: Household Members
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}

export default HouseholdStep;
