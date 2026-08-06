import "./BottomNav.css";

const TABS = [
  { key: "home", label: "Home" },
  { key: "evacuation", label: "Evacuation" },
  { key: "alerts", label: "Alerts" },
  { key: "profile", label: "Profile" },
];

const ICONS = {
  home: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  evacuation: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M3 11l18-7-7 18-2.5-7.5L3 11Z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  ),
  alerts: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3v3M4 20h16L18 15a6 6 0 0 0-12 0Z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 20a2.5 2.5 0 0 0 5 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
  profile: (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M5 20c0-3.314 3.134-6 7-6s7 2.686 7 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ),
};

function BottomNav({ active, onSelect }) {
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`bottom-nav-item ${active === tab.key ? "active" : ""}`}
          onClick={() => onSelect && onSelect(tab.key)}
        >
          {ICONS[tab.key]}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

export default BottomNav;
