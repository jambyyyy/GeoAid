import "./StepProgress.css";

const STEPS = ["Account", "Household", "Members", "Vulnerability"];

function StepProgress({ currentIndex }) {
  return (
    <div className="step-progress">
      <div className="step-progress-bars">
        {STEPS.map((label, i) => (
          <span key={label} className={`step-bar ${i <= currentIndex ? "filled" : ""}`} />
        ))}
      </div>
      <div className="step-progress-labels">
        {STEPS.map((label, i) => (
          <span key={label} className={i === currentIndex ? "current" : ""}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

export default StepProgress;
export { STEPS };
