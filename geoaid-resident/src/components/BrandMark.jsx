import "./BrandMark.css";

function ShieldIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z"
        stroke="currentColor"
        strokeWidth="1.9"
      />
    </svg>
  );
}

function BrandMark({ subtitle }) {
  return (
    <div className="brand-mark">
      <div className="brand-mark-icon">
        <ShieldIcon />
      </div>
      <div className="brand-mark-text">
        <span className="brand-mark-name">
          Geo<span className="accent">Aid</span>
        </span>
        {subtitle && <span className="brand-mark-subtitle">{subtitle}</span>}
      </div>
    </div>
  );
}

export default BrandMark;
