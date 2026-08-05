import cityLogo from "../assets/images/logo.jpg";
import "./sidebar.css";

function Sidebar({ role, navItems, activeItem, onNavItemClick }) {
  return (
    <aside className="dashboard-sidebar">
      <div className="sidebar-brand">
        <img src={cityLogo} alt="City of Iligan" className="sidebar-logo" />
        <div>
          <span className="sidebar-title">
            Geo<span className="accent">Aid</span>
          </span>
          <span className="sidebar-subtitle">{role}</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <button
            key={item}
            type="button"
            className={`nav-item ${item === activeItem ? "active" : ""}`}
            onClick={() => onNavItemClick && onNavItemClick(item)}
          >
            {item}
          </button>
        ))}
      </nav>
    </aside>
  );
}

export default Sidebar;