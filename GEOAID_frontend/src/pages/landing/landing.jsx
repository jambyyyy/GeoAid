<<<<<<< HEAD
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./landing.css";
import hero from "../../assets/images/iligan_city.jpg";
import cityLogo from "../../assets/images/logo.jpg";

/* ---------------- Icons (inline, no external icon dependency) ---------------- */

function Icon({ path, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const icons = {
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  login: (
    <>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9 16H3L12 3Z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.2 2.2L16 10" />
    </>
  ),
  checkMark: <path d="M20 6L9 17l-5-5" />,
  xMark: <path d="M18 6L6 18M6 6l12 12" />,
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2" />
    </>
  ),
  navigation: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  wifi: (
    <>
      <path d="M2 8.5a16 16 0 0 1 20 0" />
      <path d="M5 12a11 11 0 0 1 14 0" />
      <path d="M8.5 15.5a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="6" y="12" width="3" height="6" />
      <rect x="11" y="8" width="3" height="10" />
      <rect x="16" y="4" width="3" height="14" />
    </>
  ),
  shield: <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" />,
  heart: <path d="M12 20s-7-4.35-9.5-9C.5 6.5 3 3 6.5 3c2 0 3.5 1.2 4.5 2.5C12 4.2 13.5 3 15.5 3 19 3 21.5 6.5 20.5 11 18 15.65 12 20 12 20Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3 3-5.5 7-5.5s7 2.5 7 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.4.4 4 2 4 5.8" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6l8-4 8 4v15" />
      <path d="M4 21h16" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  facebook: <path d="M14 9h3V5h-3a4 4 0 0 0-4 4v2H7v4h3v6h4v-6h3l1-4h-4v-2a1 1 0 0 1 1-1Z" />,
  twitter: <path d="M22 5.9c-.7.3-1.5.6-2.3.7.8-.5 1.5-1.3 1.8-2.3-.8.5-1.7.8-2.6 1a4 4 0 0 0-6.9 3.6A11.4 11.4 0 0 1 3.6 4.7a4 4 0 0 0 1.2 5.3c-.6 0-1.2-.2-1.8-.5v.1a4 4 0 0 0 3.2 3.9c-.6.2-1.2.2-1.8.1a4 4 0 0 0 3.7 2.7A8 8 0 0 1 2 18a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6.1 11.3-11.3v-.5c.8-.5 1.4-1.2 1.9-2Z" />,
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <polygon points="10 9 16 12 10 15" fill="currentColor" stroke="none" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
    </>
  ),
};

const IconWrap = ({ name, size }) => <Icon path={icons[name]} size={size} />;

/* ---------------- Static content ---------------- */

const navItems = [
  { label: "Mission", id: "why-geoaid" },
  { label: "How It Works", id: "how-it-works" },
  { label: "Features", id: "core-capabilities" },
  { label: "Who It Serves", id: "who-it-serves" },
];

const heroStats = [
  { num: "7", lbl: "Flood-Prone Barangays" },
  { num: "12K+", lbl: "Households Registered" },
  { num: "8", lbl: "Evacuation Centers" },
];

// The 7 focus barangays currently profiled and monitored by GeoAid.
// Each links out to its own Google Maps search for a closer look.
const floodBarangayPoints = [
  "Mahayahay",
  "Tambacan",
  "Abuno",
  "Hinaplanon",
  "Pala-o Riverside",
  "Tubod",
  "Tipanoy",
];

const iliganMapsEmbedSrc =
  "https://www.google.com/maps?q=Iligan+City,+Lanao+del+Norte,+Philippines&output=embed";

const barangayMapsLink = (name) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `Barangay ${name}, Iligan City, Philippines`
  )}`;

const comparisonItems = [
  { text: "Manual paper logs", sub: "Lost, illegible, delayed", positive: false },
  { text: "GIS-powered records", sub: "Real-time, searchable", positive: true },
  { text: "Phone-tree coordination", sub: "Slow, error-prone", positive: false },
  { text: "Centralized dashboard", sub: "Instant, role-based", positive: true },
];

const impactStats = [
  { icon: "qr", stat: "< 2 min", label: "Average QR check-in time at evacuation centers" },
  { icon: "users", stat: "100%", label: "Households profiled with vulnerability data before disaster" },
  { icon: "shield", stat: "Real-time", label: "Capacity alerts sent to DRRM before centers reach 90%" },
  { icon: "building", stat: "3-tier", label: "Verification: Purok \u2192 Barangay \u2192 CSWD before relief release" },
];

const processSteps = [
  {
    num: "01",
    badge: "Mobile App",
    title: "Register Household",
    desc: "Fill in your household profile — family members, address, GPS pin, and vulnerability info (disability, health conditions, pregnancy status).",
    icon: "clipboard",
  },
  {
    num: "02",
    badge: "Local Leader",
    title: "Purok Verification",
    desc: "Your Purok President reviews and verifies your household details, then forwards it to the Barangay for final confirmation.",
    icon: "checkCircle",
  },
  {
    num: "03",
    badge: "At Shelter",
    title: "QR Check-In",
    desc: "During a disaster, show your digital QR code at any evacuation center. Staff scan it to instantly log your family in.",
    icon: "qr",
  },
  {
    num: "04",
    badge: "CSWD",
    title: "Priority Relief",
    desc: "CSWD automatically prioritizes relief distribution based on vulnerability scores — elderly, PWDs, and pregnant women first.",
    icon: "heart",
  },
];

const capabilities = [
  {
    icon: "navigation",
    title: "Real-Time Evacuation Routing",
    desc: "GIS-powered routes update during active disasters, accounting for road closures, hazard zones, and center capacity.",
    className: "cap-blue",
  },
  {
    icon: "qr",
    title: "QR Check-In System",
    desc: "Each household gets a permanent digital ID card with QR code. Check-in under 2 minutes at any registered evacuation center.",
    className: "cap-teal",
  },
  {
    icon: "heart",
    title: "Vulnerability-Based Prioritization",
    desc: "Automatic scoring ranks households by age, disability status, pregnancy, health conditions, and socio-economic factors.",
    className: "cap-green",
  },
  {
    icon: "building",
    title: "Live Center Occupancy",
    desc: "Color-coded capacity gauges update in real-time. DRRM gets alerts when centers approach capacity.",
    className: "cap-indigo",
  },
  {
    icon: "chart",
    title: "Donation Transparency",
    desc: "Track every donation — intake, allocation per household, and distribution status. Full audit trail for donors and the public.",
    className: "cap-purple",
  },
  {
    icon: "wifi",
    title: "Offline-Capable Mobile App",
    desc: "Residents can access their QR code and evacuation route even without internet connection during disasters.",
    className: "cap-rose",
  },
];

const servesRoles = [
  {
    icon: "users",
    badge: "Mobile App",
    title: "Residents",
    desc: "Register household, submit vulnerability info, access evacuation routes and QR check-in card.",
    className: "role-green",
  },
  {
    icon: "shield",
    badge: "Mobile / Web",
    title: "Purok Presidents",
    desc: "Review and verify household registrations from their purok before forwarding to Barangay.",
    className: "role-blue",
  },
  {
    icon: "building",
    badge: "Web Dashboard",
    title: "Barangay Staff",
    desc: "Final registration approval, QR scanner for evacuee check-in/out, relief distribution management.",
    className: "role-purple",
  },
  {
    icon: "heart",
    badge: "Web Dashboard",
    title: "CSWD Personnel",
    desc: "Vulnerability-based priority lists, relief inventory, donation intake and allocation tracking.",
    className: "role-pink",
  },
  {
    icon: "alert",
    badge: "Web Dashboard",
    title: "DRRM Office",
    desc: "City-wide situational map, real-time occupancy overview, evacuation routing and disaster reports.",
    className: "role-amber",
  },
];

function Landing() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const goToLogin = () => navigate("/login");

  const scrollToSection = (id) => {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-page">
      {/* ---------- Navbar ---------- */}
      <header className="landing-navbar">
        <div className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <img src={cityLogo} alt="City of Iligan Official Seal" className="nav-logo" />
          <div className="nav-brand-text">
            <span className="brand-name">
              Geo<span className="accent">Aid</span>
            </span>
          </div>
        </div>

        <nav>
          <ul className="nav-links">
            {navItems.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => scrollToSection(item.id)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="nav-actions">
          <button type="button" className="nav-login-btn" onClick={goToLogin}>
            Log In
          </button>
          <button
            type="button"
            className="nav-menu-toggle"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconWrap name={menuOpen ? "close" : "menu"} size={24} />
          </button>
        </div>

        <div className={`nav-mobile-panel ${menuOpen ? "open" : ""}`}>
          {navItems.map((item) => (
            <button key={item.id} type="button" onClick={() => scrollToSection(item.id)}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={goToLogin}>Log In</button>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="hero" style={{ backgroundImage: `url(${hero})` }}>
        <div className="hero-overlay" />
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              Smarter Disaster <span className="accent">Response</span> for Iligan City
            </h1>
            <p>
              Real-time evacuation routing, evacuee profiling, and vulnerability-based
              relief prioritization — replacing paper-based barangay records with a
              live GIS system focused on Iligan City's most flood-prone barangays:
              Mahayahay, Tambacan, Abuno, Hinaplanon, Pala-o Riverside, Tubod, and Tipanoy.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn-primary" onClick={goToLogin}>
                Log In to Dashboard
                <IconWrap name="arrowRight" size={16} />
              </button>
            </div>

            <div className="hero-stats">
              {heroStats.map((s) => (
                <div className="hero-stat" key={s.lbl}>
                  <span className="num">{s.num}</span>
                  <span className="lbl">{s.lbl}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-title-row">
              <h4>Flood-Prone Barangays</h4>
              <span className="preview-sub">Iligan City</span>
            </div>

            <div className="map-wrap">
              <iframe
                title="Map of Iligan City flood-prone barangays"
                className="barangay-map-frame"
                src={iliganMapsEmbedSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <ul className="barangay-legend">
              {floodBarangayPoints.map((name) => (
                <li key={name}>
                  <a
                    href={barangayMapsLink(name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="legend-link"
                  >
                    <span className="legend-dot" />
                    {name}
                  </a>
                </li>
              ))}
            </ul>

            <p className="map-caption">
              Live map via Google Maps — tap a barangay to view it directly on the map.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Why GeoAid ---------- */}
      <section className="why-geoaid" id="why-geoaid">
        <div className="why-geoaid-grid">
          <div className="why-geoaid-copy">
            <span className="section-label section-label-left">Why GeoAid</span>
            <h2 className="section-heading-left">Disaster Response Shouldn't Run on Paper</h2>
            <p>
              During Typhoon Sendong (2011), Iligan City lost over 1,200 lives. Manual,
              fragmented records meant relief workers couldn't identify who needed help
              most — elderly residents, PWDs, and pregnant women were unreached.
            </p>
            <p>
              GeoAid replaces handwritten logbooks, disconnected spreadsheets, and
              phone-tree coordination with a centralized, GIS-powered platform that
              gives every level of government — from Purok Presidents to the DRRM
              Office — a shared, real-time picture of who is safe, where they are,
              and what they need.
            </p>

            <div className="comparison-grid">
              {comparisonItems.map((c) => (
                <div className={`comparison-card ${c.positive ? "positive" : "negative"}`} key={c.text}>
                  <span className="comparison-icon">
                    <IconWrap name={c.positive ? "checkMark" : "xMark"} size={14} />
                  </span>
                  <div>
                    <h5>{c.text}</h5>
                    <span>{c.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="impact-card">
            <span className="impact-label">GeoAid Impact at a Glance</span>
            {impactStats.map((s) => (
              <div className="impact-row" key={s.label}>
                <span className="impact-icon">
                  <IconWrap name={s.icon} size={18} />
                </span>
                <div>
                  <span className="impact-stat">{s.stat}</span>
                  <span className="impact-desc">{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How It Works ---------- */}
      <section className="how-it-works" id="how-it-works">
        <span className="section-label">Simple Process</span>
        <h2 className="section-heading">From Registration to Relief</h2>
        <p className="section-subheading">
          Four steps, fully digital. Residents enroll once and are covered for every
          future disaster event.
        </p>

        <div className="process-row">
          {processSteps.map((step) => (
            <div className="process-step" key={step.num}>
              <span className="process-icon">
                <IconWrap name={step.icon} size={22} />
              </span>
              <span className="process-badge">{step.badge}</span>
              <span className="process-num">{step.num}</span>
              <h5>{step.title}</h5>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Core Capabilities ---------- */}
      <section className="core-capabilities" id="core-capabilities">
        <span className="section-label">Core Capabilities</span>
        <h2 className="section-heading">Built for Real Emergencies</h2>
        <div className="capabilities-grid">
          {capabilities.map((c) => (
            <div className={`capability-card ${c.className}`} key={c.title}>
              <span className="capability-icon">
                <IconWrap name={c.icon} size={20} />
              </span>
              <h4>{c.title}</h4>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Who GeoAid Serves ---------- */}
      <section className="who-it-serves" id="who-it-serves">
        <span className="section-label section-label-dark">Who GeoAid Serves</span>
        <h2 className="section-heading section-heading-dark">One System, Every Role</h2>
        <p className="section-subheading section-subheading-dark">
          From individual residents to the city DRRM office — tailored dashboards
          and permissions for each stakeholder.
        </p>

        <div className="roles-grid">
          {servesRoles.map((r) => (
            <div className={`role-card ${r.className}`} key={r.title}>
              <span className="role-icon">
                <IconWrap name={r.icon} size={20} />
              </span>
              <span className="role-badge">{r.badge}</span>
              <h4>{r.title}</h4>
              <p>{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="cta-band">
        <h2>Ready to Protect Your Community?</h2>
        <p>
          Residents register and manage their household through the GeoAid mobile app.
          Barangay, Purok, CSWD, and DRRM staff log in below.
        </p>
        <div className="cta-actions">
          <button type="button" className="btn-cta-secondary" onClick={goToLogin}>
            Staff Login
          </button>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="landing-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="footer-brand-row">
              <img src={cityLogo} alt="City of Iligan Official Seal" className="footer-logo" />
              <span className="brand-name">
                Geo<span className="accent">Aid</span>
              </span>
            </div>
            <p>
              A GIS-integrated disaster management platform developed for Iligan
              City, Philippines — a capstone project of St. Michael's College.
            </p>
            <p className="footer-partner-note">
              In partnership with the Iligan City Local Government Unit and the
              City Disaster Risk Reduction and Management Office (CDRRMO).
            </p>
            <div className="footer-social">
              <a href="#" aria-label="Facebook"><IconWrap name="facebook" size={15} /></a>
              <a href="#" aria-label="Twitter"><IconWrap name="twitter" size={15} /></a>
              <a href="#" aria-label="YouTube"><IconWrap name="youtube" size={15} /></a>
              <a href="#" aria-label="Email"><IconWrap name="mail" size={15} /></a>
            </div>
          </div>

          <div>
            <h5>Platform</h5>
            <ul>
              <li><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Landing Page</button></li>
              <li><button type="button" onClick={goToLogin}>Staff Web Dashboard</button></li>
              <li><button type="button">Component Library</button></li>
            </ul>
          </div>

          <div>
            <h5>Support</h5>
            <ul>
              <li><button type="button">User Guide</button></li>
              <li><button type="button">Barangay Onboarding</button></li>
              <li><button type="button">DRRM Integration</button></li>
              <li><button type="button">Contact CDRRMO</button></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2025 GeoAid — St. Michael's College Capstone Project, Iligan City</span>
          <span>Built for the people of Iligan City. All data is handled per the Philippine Data Privacy Act (RA 10173).</span>
        </div>
      </footer>
    </div>
  );
}

=======
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./landing.css";
import hero from "../../assets/images/iligan_city.jpg";
import cityLogo from "../../assets/images/logo.jpg";

/* ---------------- Icons (inline, no external icon dependency) ---------------- */

function Icon({ path, size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

const icons = {
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  login: (
    <>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3l9 16H3L12 3Z" />
      <path d="M12 9v4M12 16h.01" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.2 2.2L16 10" />
    </>
  ),
  checkMark: <path d="M20 6L9 17l-5-5" />,
  xMark: <path d="M18 6L6 18M6 6l12 12" />,
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2" />
    </>
  ),
  navigation: <polygon points="3 11 22 2 13 21 11 13 3 11" />,
  wifi: (
    <>
      <path d="M2 8.5a16 16 0 0 1 20 0" />
      <path d="M5 12a11 11 0 0 1 14 0" />
      <path d="M8.5 15.5a6 6 0 0 1 7 0" />
      <circle cx="12" cy="19" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20h16" />
      <rect x="6" y="12" width="3" height="6" />
      <rect x="11" y="8" width="3" height="10" />
      <rect x="16" y="4" width="3" height="14" />
    </>
  ),
  shield: <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" />,
  heart: <path d="M12 20s-7-4.35-9.5-9C.5 6.5 3 3 6.5 3c2 0 3.5 1.2 4.5 2.5C12 4.2 13.5 3 15.5 3 19 3 21.5 6.5 20.5 11 18 15.65 12 20 12 20Z" />,
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3 3-5.5 7-5.5s7 2.5 7 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.4.4 4 2 4 5.8" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6l8-4 8 4v15" />
      <path d="M4 21h16" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  facebook: <path d="M14 9h3V5h-3a4 4 0 0 0-4 4v2H7v4h3v6h4v-6h3l1-4h-4v-2a1 1 0 0 1 1-1Z" />,
  twitter: <path d="M22 5.9c-.7.3-1.5.6-2.3.7.8-.5 1.5-1.3 1.8-2.3-.8.5-1.7.8-2.6 1a4 4 0 0 0-6.9 3.6A11.4 11.4 0 0 1 3.6 4.7a4 4 0 0 0 1.2 5.3c-.6 0-1.2-.2-1.8-.5v.1a4 4 0 0 0 3.2 3.9c-.6.2-1.2.2-1.8.1a4 4 0 0 0 3.7 2.7A8 8 0 0 1 2 18a11.3 11.3 0 0 0 6.1 1.8c7.3 0 11.3-6.1 11.3-11.3v-.5c.8-.5 1.4-1.2 1.9-2Z" />,
  youtube: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="4" />
      <polygon points="10 9 16 12 10 15" fill="currentColor" stroke="none" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12Z" />
      <circle cx="12" cy="9" r="2.4" />
    </>
  ),
};

const IconWrap = ({ name, size }) => <Icon path={icons[name]} size={size} />;

/* ---------------- Static content ---------------- */

const navItems = [
  { label: "Mission", id: "why-geoaid" },
  { label: "How It Works", id: "how-it-works" },
  { label: "Features", id: "core-capabilities" },
  { label: "Who It Serves", id: "who-it-serves" },
];

const heroStats = [
  { num: "7", lbl: "Flood-Prone Barangays" },
  { num: "12K+", lbl: "Households Registered" },
  { num: "8", lbl: "Evacuation Centers" },
];

// The 7 focus barangays currently profiled and monitored by GeoAid.
// Each links out to its own Google Maps search for a closer look.
const floodBarangayPoints = [
  "Mahayahay",
  "Tambacan",
  "Abuno",
  "Hinaplanon",
  "Pala-o Riverside",
  "Tubod",
  "Tipanoy",
];

const iliganMapsEmbedSrc =
  "https://www.google.com/maps?q=Iligan+City,+Lanao+del+Norte,+Philippines&output=embed";

const barangayMapsLink = (name) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `Barangay ${name}, Iligan City, Philippines`
  )}`;

const comparisonItems = [
  { text: "Manual paper logs", sub: "Lost, illegible, delayed", positive: false },
  { text: "GIS-powered records", sub: "Real-time, searchable", positive: true },
  { text: "Phone-tree coordination", sub: "Slow, error-prone", positive: false },
  { text: "Centralized dashboard", sub: "Instant, role-based", positive: true },
];

const impactStats = [
  { icon: "qr", stat: "< 2 min", label: "Average QR check-in time at evacuation centers" },
  { icon: "users", stat: "100%", label: "Households profiled with vulnerability data before disaster" },
  { icon: "shield", stat: "Real-time", label: "Capacity alerts sent to DRRM before centers reach 90%" },
  { icon: "building", stat: "3-tier", label: "Verification: Purok \u2192 Barangay \u2192 CSWD before relief release" },
];

const processSteps = [
  {
    num: "01",
    badge: "Mobile App",
    title: "Register Household",
    desc: "Fill in your household profile — family members, address, GPS pin, and vulnerability info (disability, health conditions, pregnancy status).",
    icon: "clipboard",
  },
  {
    num: "02",
    badge: "Local Leader",
    title: "Purok Verification",
    desc: "Your Purok President reviews and verifies your household details, then forwards it to the Barangay for final confirmation.",
    icon: "checkCircle",
  },
  {
    num: "03",
    badge: "At Shelter",
    title: "QR Check-In",
    desc: "During a disaster, show your digital QR code at any evacuation center. Staff scan it to instantly log your family in.",
    icon: "qr",
  },
  {
    num: "04",
    badge: "CSWD",
    title: "Priority Relief",
    desc: "CSWD automatically prioritizes relief distribution based on vulnerability scores — elderly, PWDs, and pregnant women first.",
    icon: "heart",
  },
];

const capabilities = [
  {
    icon: "navigation",
    title: "Real-Time Evacuation Routing",
    desc: "GIS-powered routes update during active disasters, accounting for road closures, hazard zones, and center capacity.",
    className: "cap-blue",
  },
  {
    icon: "qr",
    title: "QR Check-In System",
    desc: "Each household gets a permanent digital ID card with QR code. Check-in under 2 minutes at any registered evacuation center.",
    className: "cap-teal",
  },
  {
    icon: "heart",
    title: "Vulnerability-Based Prioritization",
    desc: "Automatic scoring ranks households by age, disability status, pregnancy, health conditions, and socio-economic factors.",
    className: "cap-green",
  },
  {
    icon: "building",
    title: "Live Center Occupancy",
    desc: "Color-coded capacity gauges update in real-time. DRRM gets alerts when centers approach capacity.",
    className: "cap-indigo",
  },
  {
    icon: "chart",
    title: "Donation Transparency",
    desc: "Track every donation — intake, allocation per household, and distribution status. Full audit trail for donors and the public.",
    className: "cap-purple",
  },
  {
    icon: "wifi",
    title: "Offline-Capable Mobile App",
    desc: "Residents can access their QR code and evacuation route even without internet connection during disasters.",
    className: "cap-rose",
  },
];

const servesRoles = [
  {
    icon: "users",
    badge: "Mobile App",
    title: "Residents",
    desc: "Register household, submit vulnerability info, access evacuation routes and QR check-in card.",
    className: "role-green",
  },
  {
    icon: "shield",
    badge: "Mobile / Web",
    title: "Purok Presidents",
    desc: "Review and verify household registrations from their purok before forwarding to Barangay.",
    className: "role-blue",
  },
  {
    icon: "building",
    badge: "Web Dashboard",
    title: "Barangay Staff",
    desc: "Final registration approval, QR scanner for evacuee check-in/out, relief distribution management.",
    className: "role-purple",
  },
  {
    icon: "heart",
    badge: "Web Dashboard",
    title: "CSWD Personnel",
    desc: "Vulnerability-based priority lists, relief inventory, donation intake and allocation tracking.",
    className: "role-pink",
  },
  {
    icon: "alert",
    badge: "Web Dashboard",
    title: "DRRM Office",
    desc: "City-wide situational map, real-time occupancy overview, evacuation routing and disaster reports.",
    className: "role-amber",
  },
];

function Landing() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const goToLogin = () => navigate("/login");
  const goToRegister = () => navigate("/register");

  const scrollToSection = (id) => {
    setMenuOpen(false);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="landing-page">
      {/* ---------- Navbar ---------- */}
      <header className="landing-navbar">
        <div className="nav-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
          <img src={cityLogo} alt="City of Iligan Official Seal" className="nav-logo" />
          <div className="nav-brand-text">
            <span className="brand-name">
              Geo<span className="accent">Aid</span>
            </span>
          </div>
        </div>

        <nav>
          <ul className="nav-links">
            {navItems.map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => scrollToSection(item.id)}>
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="nav-actions">
          <button type="button" className="nav-login-btn" onClick={goToLogin}>
            Log In
          </button>
          <button type="button" className="nav-register-btn" onClick={goToRegister}>
            Register as Resident
          </button>
          <button
            type="button"
            className="nav-menu-toggle"
            aria-label="Toggle menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <IconWrap name={menuOpen ? "close" : "menu"} size={24} />
          </button>
        </div>

        <div className={`nav-mobile-panel ${menuOpen ? "open" : ""}`}>
          {navItems.map((item) => (
            <button key={item.id} type="button" onClick={() => scrollToSection(item.id)}>
              {item.label}
            </button>
          ))}
          <button type="button" onClick={goToLogin}>Log In</button>
          <button type="button" onClick={goToRegister}>Register as Resident</button>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="hero" style={{ backgroundImage: `url(${hero})` }}>
        <div className="hero-overlay" />
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              Smarter Disaster <span className="accent">Response</span> for Iligan City
            </h1>
            <p>
              Real-time evacuation routing, evacuee profiling, and vulnerability-based
              relief prioritization — replacing paper-based barangay records with a
              live GIS system focused on Iligan City's most flood-prone barangays:
              Mahayahay, Tambacan, Abuno, Hinaplanon, Pala-o Riverside, Tubod, and Tipanoy.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn-primary" onClick={goToLogin}>
                Log In to Dashboard
                <IconWrap name="arrowRight" size={16} />
              </button>
              <button type="button" className="btn-secondary" onClick={goToRegister}>
                Register as Resident
              </button>
            </div>

            <div className="hero-stats">
              {heroStats.map((s) => (
                <div className="hero-stat" key={s.lbl}>
                  <span className="num">{s.num}</span>
                  <span className="lbl">{s.lbl}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-title-row">
              <h4>Flood-Prone Barangays</h4>
              <span className="preview-sub">Iligan City</span>
            </div>

            <div className="map-wrap">
              <iframe
                title="Map of Iligan City flood-prone barangays"
                className="barangay-map-frame"
                src={iliganMapsEmbedSrc}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>

            <ul className="barangay-legend">
              {floodBarangayPoints.map((name) => (
                <li key={name}>
                  <a
                    href={barangayMapsLink(name)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="legend-link"
                  >
                    <span className="legend-dot" />
                    {name}
                  </a>
                </li>
              ))}
            </ul>

            <p className="map-caption">
              Live map via Google Maps — tap a barangay to view it directly on the map.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Why GeoAid ---------- */}
      <section className="why-geoaid" id="why-geoaid">
        <div className="why-geoaid-grid">
          <div className="why-geoaid-copy">
            <span className="section-label section-label-left">Why GeoAid</span>
            <h2 className="section-heading-left">Disaster Response Shouldn't Run on Paper</h2>
            <p>
              During Typhoon Sendong (2011), Iligan City lost over 1,200 lives. Manual,
              fragmented records meant relief workers couldn't identify who needed help
              most — elderly residents, PWDs, and pregnant women were unreached.
            </p>
            <p>
              GeoAid replaces handwritten logbooks, disconnected spreadsheets, and
              phone-tree coordination with a centralized, GIS-powered platform that
              gives every level of government — from Purok Presidents to the DRRM
              Office — a shared, real-time picture of who is safe, where they are,
              and what they need.
            </p>

            <div className="comparison-grid">
              {comparisonItems.map((c) => (
                <div className={`comparison-card ${c.positive ? "positive" : "negative"}`} key={c.text}>
                  <span className="comparison-icon">
                    <IconWrap name={c.positive ? "checkMark" : "xMark"} size={14} />
                  </span>
                  <div>
                    <h5>{c.text}</h5>
                    <span>{c.sub}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="impact-card">
            <span className="impact-label">GeoAid Impact at a Glance</span>
            {impactStats.map((s) => (
              <div className="impact-row" key={s.label}>
                <span className="impact-icon">
                  <IconWrap name={s.icon} size={18} />
                </span>
                <div>
                  <span className="impact-stat">{s.stat}</span>
                  <span className="impact-desc">{s.label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- How It Works ---------- */}
      <section className="how-it-works" id="how-it-works">
        <span className="section-label">Simple Process</span>
        <h2 className="section-heading">From Registration to Relief</h2>
        <p className="section-subheading">
          Four steps, fully digital. Residents enroll once and are covered for every
          future disaster event.
        </p>

        <div className="process-row">
          {processSteps.map((step) => (
            <div className="process-step" key={step.num}>
              <span className="process-icon">
                <IconWrap name={step.icon} size={22} />
              </span>
              <span className="process-badge">{step.badge}</span>
              <span className="process-num">{step.num}</span>
              <h5>{step.title}</h5>
              <p>{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Core Capabilities ---------- */}
      <section className="core-capabilities" id="core-capabilities">
        <span className="section-label">Core Capabilities</span>
        <h2 className="section-heading">Built for Real Emergencies</h2>
        <div className="capabilities-grid">
          {capabilities.map((c) => (
            <div className={`capability-card ${c.className}`} key={c.title}>
              <span className="capability-icon">
                <IconWrap name={c.icon} size={20} />
              </span>
              <h4>{c.title}</h4>
              <p>{c.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Who GeoAid Serves ---------- */}
      <section className="who-it-serves" id="who-it-serves">
        <span className="section-label section-label-dark">Who GeoAid Serves</span>
        <h2 className="section-heading section-heading-dark">One System, Every Role</h2>
        <p className="section-subheading section-subheading-dark">
          From individual residents to the city DRRM office — tailored dashboards
          and permissions for each stakeholder.
        </p>

        <div className="roles-grid">
          {servesRoles.map((r) => (
            <div className={`role-card ${r.className}`} key={r.title}>
              <span className="role-icon">
                <IconWrap name={r.icon} size={20} />
              </span>
              <span className="role-badge">{r.badge}</span>
              <h4>{r.title}</h4>
              <p>{r.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- CTA ---------- */}
      <section className="cta-band">
        <h2>Ready to Protect Your Community?</h2>
        <p>
          Register your household today and ensure your family is counted,
          verified, and prioritized when it matters most.
        </p>
        <div className="cta-actions">
          <button type="button" className="btn-cta-primary" onClick={goToRegister}>
            Register as Resident
            <IconWrap name="arrowRight" size={16} />
          </button>
          <button type="button" className="btn-cta-secondary" onClick={goToLogin}>
            Staff Login
          </button>
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="landing-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <div className="footer-brand-row">
              <img src={cityLogo} alt="City of Iligan Official Seal" className="footer-logo" />
              <span className="brand-name">
                Geo<span className="accent">Aid</span>
              </span>
            </div>
            <p>
              A GIS-integrated disaster management platform developed for Iligan
              City, Philippines — a capstone project of St. Michael's College.
            </p>
            <p className="footer-partner-note">
              In partnership with the Iligan City Local Government Unit and the
              City Disaster Risk Reduction and Management Office (CDRRMO).
            </p>
            <div className="footer-social">
              <a href="#" aria-label="Facebook"><IconWrap name="facebook" size={15} /></a>
              <a href="#" aria-label="Twitter"><IconWrap name="twitter" size={15} /></a>
              <a href="#" aria-label="YouTube"><IconWrap name="youtube" size={15} /></a>
              <a href="#" aria-label="Email"><IconWrap name="mail" size={15} /></a>
            </div>
          </div>

          <div>
            <h5>Platform</h5>
            <ul>
              <li><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Landing Page</button></li>
              <li><button type="button" onClick={goToRegister}>Resident Mobile App</button></li>
              <li><button type="button" onClick={goToLogin}>Staff Web Dashboard</button></li>
              <li><button type="button">Component Library</button></li>
            </ul>
          </div>

          <div>
            <h5>Support</h5>
            <ul>
              <li><button type="button">User Guide</button></li>
              <li><button type="button">Barangay Onboarding</button></li>
              <li><button type="button">DRRM Integration</button></li>
              <li><button type="button">Contact CDRRMO</button></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <span>© 2025 GeoAid — St. Michael's College Capstone Project, Iligan City</span>
          <span>Built for the people of Iligan City. All data is handled per the Philippine Data Privacy Act (RA 10173).</span>
        </div>
      </footer>
    </div>
  );
}

>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
export default Landing;