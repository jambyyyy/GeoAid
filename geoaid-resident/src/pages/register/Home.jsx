import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import MobileShell from "../../components/MobileShell";
import BottomNav from "../../components/BottomNav";
import { API_URL } from "../../config";
import "./Home.css";

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v3M4 20h16L18 15a6 6 0 0 0-12 0Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 3 2 20h20L12 3Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <path d="M12 10v4M12 17h.01" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function NavIconArrow() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 11l18-7-7 18-2.5-7.5L3 11Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

function QRIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <rect x="14" y="3" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <rect x="3" y="14" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <path d="M14 14h3v3h-3zM19 14h2v2h-2zM14 19h2v2h-2zM19 19h2v2h-2z" fill="currentColor" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.75" />
      <path d="M12 7v5l3.5 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="9" r="2.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

// Vulnerability flags collected in Step 4 map to small colored badges
// next to each member's name.
const FLAG_CLASS = {
  "4Ps": "flag-4ps",
  PWD: "flag-pwd",
  Pregnant: "flag-pregnant",
  Elderly: "flag-elderly",
  "Child<5": "flag-child",
};

// Fallback shown while the dashboard endpoint doesn't exist yet /
// isn't reachable, so the screen still resembles the mockup. No
// members here — those only ever come from what the resident actually
// entered in Steps 3-4 of registration.
const FALLBACK_DATA = {
  household_name: "Santos Household",
  unread_alerts: 2,
  advisory: {
    title: "Flood Advisory — Tibanga",
    body: "PAGASA: Heavy rainfall expected. Prepare go-bag. Issued 7:45 AM",
  },
  nearest_center: {
    name: "Tibanga Gymnasium",
    distance_km: 0.8,
    walk_minutes: 10,
    status: "open",
    occupancy: 87,
    capacity: 300,
  },
  members: [],
};

function Home() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [activeTab, setActiveTab] = useState("home");

  useEffect(() => {
    const fetchDashboard = async () => {
      const mobileNumber = sessionStorage.getItem("geoaid_resident_mobile") || "";

      try {
        const response = await fetch(
          `${API_URL}/api/resident/dashboard/?mobile_number=${encodeURIComponent(mobileNumber)}`
        );
        if (!response.ok) throw new Error(`Dashboard request failed (${response.status})`);
        const json = await response.json();
        setData(json);
      } catch (err) {
        // Backend unreachable — keep the screen usable with the same
        // demo data the mockup was built from, rather than a blank page.
        console.warn("Falling back to mock dashboard data:", err.message);
        setData(FALLBACK_DATA);
      }
    };

    fetchDashboard();
  }, []);

  if (!data) {
    return (
      <MobileShell>
        <div className="home-loading">Loading dashboard…</div>
      </MobileShell>
    );
  }

  const { household_name, unread_alerts, advisory, nearest_center, members = [] } = data;
  const occupancyPct = Math.round((nearest_center.occupancy / nearest_center.capacity) * 100);

  return (
    <MobileShell>
      <div className="home-screen">
        <header className="home-header">
          <div>
            <p className="greeting">Good morning,</p>
            <h1>{household_name}</h1>
          </div>
          <button type="button" className="bell-btn" aria-label="Notifications">
            <BellIcon />
            {unread_alerts > 0 && <span className="bell-badge">{unread_alerts}</span>}
          </button>
        </header>

        <div className="home-body">
          {advisory && (
            <div className="advisory-card">
              <WarnIcon />
              <div>
                <p className="advisory-title">{advisory.title}</p>
                <p className="advisory-body">{advisory.body}</p>
              </div>
            </div>
          )}

          <section className="quick-actions">
            <button type="button" className="quick-action action-green" onClick={() => setActiveTab("evacuation")}>
              <NavIconArrow />
              <span>Evacuation Route</span>
            </button>
            <button type="button" className="quick-action action-navy">
              <QRIcon />
              <span>My QR Code</span>
            </button>
            <button type="button" className="quick-action action-orange">
              <ClockIcon />
              <span>Reg. Status</span>
            </button>
          </section>

          <section className="center-card">
            <p className="section-label">Nearest Evacuation Center</p>
            <div className="center-card-panel">
              <div className="center-card-top">
                <div>
                  <p className="center-name">{nearest_center.name}</p>
                  <p className="center-meta">
                    {nearest_center.distance_km} km away · ~{nearest_center.walk_minutes} min walk
                  </p>
                </div>
                <span className="status-pill">{nearest_center.status === "open" ? "OPEN" : "CLOSED"}</span>
              </div>

              <div className="occupancy-row">
                <span>Occupancy</span>
                <span>{nearest_center.occupancy} / {nearest_center.capacity}</span>
              </div>
              <div className="occupancy-bar">
                <div className="occupancy-fill" style={{ width: `${occupancyPct}%` }} />
              </div>

              <button type="button" className="directions-btn">
                <PinIcon /> Get Directions
              </button>
            </div>
          </section>

          <section className="members-section">
            <p className="section-label">Household Members ({members.length})</p>
            {members.length === 0 ? (
              <div className="members-empty">
                No household members on file yet. Finish registration Steps 3-4 to add them here.
              </div>
            ) : (
              <div className="members-list">
                {members.map((m, i) => (
                  <div key={`${m.name}-${i}`} className="member-row">
                    <div className="member-avatar" />
                    <div className="member-info">
                      <p className="member-name">{m.name}</p>
                      <p className="member-role">{m.role}</p>
                    </div>
                    {m.flags?.length > 0 && (
                      <div className="member-flags">
                        {m.flags.map((f) => (
                          <span key={f} className={`flag-badge ${FLAG_CLASS[f] || ""}`}>{f}</span>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <BottomNav
          active={activeTab}
          onSelect={(tab) => {
            setActiveTab(tab);
            if (tab === "profile") {
              // Placeholder sign-out path until a real profile screen exists.
              sessionStorage.removeItem("geoaid_resident_mobile");
              navigate("/login");
            }
          }}
        />
      </div>
    </MobileShell>
  );
}

export default Home;
