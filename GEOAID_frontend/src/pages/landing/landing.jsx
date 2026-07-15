import { useState, Fragment } from "react";
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
  play: <polygon points="6 3 20 12 6 21 6 3" fill="currentColor" stroke="none" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  login: (
    <>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6" />
    </>
  ),
  clipboard: (
    <>
      <rect x="6" y="4" width="12" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 11h6M9 15h6" />
    </>
  ),
  check: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12.5l2.2 2.2L16 10" />
    </>
  ),
  run: <circle cx="13" cy="6" r="2" />,
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM19 14h2M14 19h2M19 19h2" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  award: (
    <>
      <circle cx="12" cy="8" r="5" />
      <path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5" />
    </>
  ),
  box: (
    <>
      <path d="M21 8l-9-5-9 5 9 5 9-5Z" />
      <path d="M3 8v8l9 5 9-5V8" />
      <path d="M12 13v8" />
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
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M2 20c0-3 3-5.5 7-5.5s7 2.5 7 5.5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.4.4 4 2 4 5.8" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-3.5 3.5-6.5 8-6.5s8 3 8 6.5" />
    </>
  ),
  phone: (
    <>
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M11 18h2" />
    </>
  ),
  building: (
    <>
      <path d="M4 21V6l8-4 8 4v15" />
      <path d="M4 21h16" />
      <path d="M10 21v-6h4v6" />
    </>
  ),
  truck: (
    <>
      <rect x="1" y="7" width="13" height="10" rx="1" />
      <path d="M14 10h4l3 3v4h-7z" />
      <circle cx="6" cy="19" r="1.6" />
      <circle cx="17" cy="19" r="1.6" />
    </>
  ),
  siren: (
    <>
      <path d="M12 3a5 5 0 0 1 5 5v6H7V8a5 5 0 0 1 5-5Z" />
      <path d="M5 20a7 7 0 0 1 14 0Z" />
      <path d="M12 1v1" />
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

const navItems = ["Home", "Features", "Workflow", "Modules", "About", "Contact"];

const stakeholders = [
  { name: "DRRM", sub: "Iligan City", icon: "shield", bg: "#fee2e2", color: "#dc2626" },
  { name: "CSWD", sub: "Iligan City", icon: "heart", bg: "#dbeafe", color: "#2563eb" },
  { name: "Barangays", sub: "Iligan City", icon: "home", bg: "#dcfce7", color: "#16a34a" },
  { name: "Purok Presidents", sub: "Community Leaders", icon: "person", bg: "#ede9fe", color: "#7c3aed" },
  { name: "Residents", sub: "Iligan City", icon: "users", bg: "#dbeafe", color: "#2563eb" },
];

const workflowSteps = [
  { title: "Registration", desc: "Residents register annually with their barangay", icon: "clipboard", color: "#2563eb" },
  { title: "Verification", desc: "Purok President verifies and Barangay approves", icon: "check", color: "#16a34a" },
  { title: "Evacuation", desc: "Real-time routes and evacuation center guidance", icon: "run", color: "#0ea5e9" },
  { title: "QR Check-in", desc: "Scan QR code upon arrival to mark as safe", icon: "qr", color: "#16a34a" },
  { title: "Monitoring", desc: "Live occupancy and evacuee monitoring", icon: "monitor", color: "#7c3aed" },
  { title: "Prioritization", desc: "Vulnerability-based priority for those who need it most", icon: "award", color: "#d97706" },
  { title: "Distribution", desc: "Transparent relief distribution tracking per household", icon: "box", color: "#0d9488" },
  { title: "Reports", desc: "Data-driven reports for better decision making", icon: "chart", color: "#2563eb" },
];

const modules = [
  {
    key: "module-resident",
    icon: "phone",
    title: "Resident Mobile App",
    items: ["Register Household", "View Evacuation Routes", "QR Code Check-in", "Relief Status Updates"],
  },
  {
    key: "module-purok",
    icon: "person",
    title: "Purok President",
    items: ["Verify Household Info", "Approve Family Members", "Forward to Barangay"],
  },
  {
    key: "module-barangay",
    icon: "home",
    title: "Barangay Staff Portal",
    items: ["Manage Evacuation Centers", "Scan QR & Check-in", "Monitor Occupancy", "Distribution Management"],
  },
  {
    key: "module-cswd",
    icon: "heart",
    title: "CSWD Personnel",
    items: ["Vulnerability Prioritization", "Relief Allocation", "Donations Management", "Distribution Monitoring"],
  },
  {
    key: "module-drrm",
    icon: "siren",
    title: "DRRM Dashboard",
    items: ["Disaster Location Monitoring", "Risk Area Mapping (GIS)", "Situation Overview", "Generate Reports"],
  },
];

const statsBanner = [
  { icon: "users", num: "18,394+", lbl: "Households Registered" },
  { icon: "shield", num: "24", lbl: "Evacuation Centers Monitored" },
  { icon: "qr", num: "2,458+", lbl: "Evacuees Checked-in (Real-time)" },
  { icon: "truck", num: "12,876+", lbl: "Relief Goods Distributed" },
  { icon: "chart", num: "100%", lbl: "Transparent & Accountable" },
];

const occupancyPreview = [
  { name: "Dodiongan", pct: 85, color: "#dc2626" },
  { name: "Buru-un", pct: 65, color: "#d97706" },
  { name: "Maria Cristina", pct: 98, color: "#dc2626" },
  { name: "Hinaplanon", pct: 40, color: "#16a34a" },
];

function Landing() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const goToLogin = () => navigate("/login");

  return (
    <div className="landing-page">
      {/* ---------- Navbar ---------- */}
      <header className="landing-navbar">
        <div className="nav-brand">
          <img src={cityLogo} alt="City of Iligan Official Seal" className="nav-logo" />
          <div className="nav-brand-text">
            <span className="brand-name">
              Geo<span className="accent">Aid</span>
            </span>
            <span className="brand-tag">Disaster Management System</span>
          </div>
        </div>

        <nav>
          <ul className="nav-links">
            {navItems.map((item) => (
              <li key={item}>
                <button type="button" className={item === "Home" ? "active" : ""}>
                  {item}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <div className="nav-actions">
          <button type="button" className="nav-login-btn" onClick={goToLogin}>
            <IconWrap name="login" size={16} />
            Login
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
            <button key={item} type="button" onClick={() => setMenuOpen(false)}>
              {item}
            </button>
          ))}
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="hero" style={{ backgroundImage: `url(${hero})` }}>
        <div className="hero-overlay" />
        <div className="hero-inner">
          <div className="hero-copy">
            <h1>
              Smarter Disaster Response Starts with <span className="accent">GeoAid</span>
            </h1>
            <p>
              A GIS-integrated mobile and web platform for evacuation management,
              resident profiling, QR check-in, relief distribution, and real-time
              disaster monitoring.
            </p>
            <div className="hero-cta">
              <button type="button" className="btn-primary" onClick={goToLogin}>
                Explore Platform
                <IconWrap name="arrowRight" size={16} />
              </button>
              <button type="button" className="btn-secondary">
                <IconWrap name="play" size={14} />
                Watch Demo
              </button>
            </div>
          </div>

          <div className="hero-preview">
            <div className="preview-sidebar-row">
              <span className="preview-dot" />
              GeoAid
            </div>
            <div className="preview-card">
              <div className="preview-title-row">
                <h4>Dashboard</h4>
                <span className="preview-live">LIVE</span>
              </div>
              <div className="preview-stats">
                <div className="preview-stat">
                  <span className="num">24</span>
                  <span className="lbl">Evac Centers</span>
                </div>
                <div className="preview-stat">
                  <span className="num">2,458</span>
                  <span className="lbl">Total Evacuees</span>
                </div>
                <div className="preview-stat">
                  <span className="num">18,394</span>
                  <span className="lbl">Households</span>
                </div>
                <div className="preview-stat">
                  <span className="num">12,876</span>
                  <span className="lbl">Relief Given</span>
                </div>
              </div>
              <div className="preview-occupancy">
                <h5>Evacuation Center Occupancy</h5>
                {occupancyPreview.map((o) => (
                  <div className="occ-row" key={o.name}>
                    <span>{o.name}</span>
                    <span className="occ-bar">
                      <span
                        className="occ-fill"
                        style={{ width: `${o.pct}%`, background: o.color }}
                      />
                    </span>
                    <span>{o.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Stakeholders strip ---------- */}
      <section className="stakeholders">
        <div className="stakeholders-row">
          {stakeholders.map((s) => (
            <div className="stakeholder-item" key={s.name}>
              <span
                className="stakeholder-icon"
                style={{ background: s.bg, color: s.color }}
              >
                <IconWrap name={s.icon} size={20} />
              </span>
              <div>
                <h4>{s.name}</h4>
                <span>{s.sub}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How GeoAid Works ---------- */}
      <section className="workflow" id="workflow">
        <span className="section-label">The Process</span>
        <h2 className="section-heading">How GeoAid Works</h2>
        <div className="workflow-row">
          {workflowSteps.map((step, i) => (
            <Fragment key={step.title}>
              <div className="workflow-step">
                <span className="workflow-circle" style={{ background: step.color }}>
                  <IconWrap name={step.icon} size={22} />
                </span>
                <h5>{i + 1}. {step.title}</h5>
                <p>{step.desc}</p>
              </div>
              {i < workflowSteps.length - 1 && (
                <span className="workflow-arrow">
                  <IconWrap name="arrowRight" size={18} />
                </span>
              )}
            </Fragment>
          ))}
        </div>
      </section>

      {/* ---------- Modules ---------- */}
      <section id="modules">
        <span className="section-label">Built For Every Role</span>
        <h2 className="section-heading">Modules for Every Responder</h2>
        <div className="modules-grid">
          {modules.map((m) => (
            <article className={`module-card ${m.key}`} key={m.key}>
              <span className="module-icon">
                <IconWrap name={m.icon} size={20} />
              </span>
              <h4>{m.title}</h4>
              <ul>
                {m.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <button type="button" className="module-learn-more">
                Learn more
                <IconWrap name="arrowRight" size={13} />
              </button>
            </article>
          ))}
        </div>
      </section>

      {/* ---------- Stats banner ---------- */}
      <section className="stats-banner">
        <div className="stats-banner-row">
          {statsBanner.map((s) => (
            <div className="stats-banner-item" key={s.lbl}>
              <span className="stats-banner-icon">
                <IconWrap name={s.icon} size={20} />
              </span>
              <div>
                <span className="num">{s.num}</span>
                <span className="lbl">{s.lbl}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- Footer ---------- */}
      <footer className="landing-footer">
        <div className="footer-grid">
          <div className="footer-brand">
            <span className="brand-name">
              Geo<span className="accent">Aid</span>
            </span>
            <p>
              Building a safer Iligan City through technology, coordination,
              and community.
            </p>
            <div className="footer-social">
              <a href="#" aria-label="Facebook"><IconWrap name="facebook" size={15} /></a>
              <a href="#" aria-label="Twitter"><IconWrap name="twitter" size={15} /></a>
              <a href="#" aria-label="YouTube"><IconWrap name="youtube" size={15} /></a>
              <a href="#" aria-label="Email"><IconWrap name="mail" size={15} /></a>
            </div>
          </div>

          <div>
            <h5>Quick Links</h5>
            <ul>
              <li><button type="button">Home</button></li>
              <li><button type="button">Features</button></li>
              <li><button type="button">Workflow</button></li>
              <li><button type="button">Modules</button></li>
            </ul>
          </div>

          <div>
            <h5>Resources</h5>
            <ul>
              <li><button type="button">User Guide</button></li>
              <li><button type="button">Privacy Policy</button></li>
              <li><button type="button">Terms of Use</button></li>
              <li><button type="button">FAQs</button></li>
            </ul>
          </div>

          <div>
            <h5>Contact Us</h5>
            <div className="footer-contact-item">
              <IconWrap name="pin" size={15} />
              <span>City Disaster Risk Reduction and Management Office, Iligan City, Philippines</span>
            </div>
            <div className="footer-contact-item">
              <span>info@geoaid.iligan.gov.ph</span>
            </div>
          </div>

          <div>
            <h5>Login</h5>
            <ul>
              <li><button type="button" onClick={goToLogin}>Authorized Personnel Login</button></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          © 2026 GeoAid. All rights reserved.
        </div>
      </footer>
    </div>
  );
}

export default Landing;