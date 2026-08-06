import "./MobileShell.css";

// Wraps every screen in a phone-width column. On desktop browsers this
// centers the app like a phone preview; on an actual mobile browser it
// simply fills the viewport. Keeps every page the same width/gutters
// instead of each page re-implementing its own container.
function MobileShell({ children, tone = "light" }) {
  return (
    <div className="mobile-shell-outer">
      <div className={`mobile-shell tone-${tone}`}>{children}</div>
    </div>
  );
}

export default MobileShell;
