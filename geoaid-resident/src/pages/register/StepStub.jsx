import "./StepStub.css";

function StepStub({ title, note, nextLabel, onNext }) {
  return (
    <div className="step-stub">
      <div className="step-stub-placeholder">
        <p className="step-stub-title">{title}</p>
        <p className="step-stub-note">{note}</p>
      </div>

      <button type="button" className="continue-btn" onClick={onNext}>
        {nextLabel}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

export default StepStub;
