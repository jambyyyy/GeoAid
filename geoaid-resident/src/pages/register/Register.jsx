import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MobileShell from "../../components/MobileShell";
import StepProgress, { STEPS } from "../../components/StepProgress";
import AccountStep from "./AccountStep";
import StepStub from "./StepStub";
import "./Register.css";

const STEP_COPY = [
  null, // Account step renders its own full form
  {
    title: "Household Details",
    note:
      "This step will capture the household's address, GPS pin, dwelling type, and Purok/Barangay assignment.",
  },
  {
    title: "Household Members",
    note:
      "This step will let the head of household add each family member — name, age, relation, and any ID needed for evacuation check-in.",
  },
  {
    title: "Vulnerability Assessment",
    note:
      "This step will flag priority members — PWD, elderly, pregnant, 4Ps, children under 5 — so responders can prioritize relief and evacuation assistance.",
  },
];

function Register() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [account, setAccount] = useState(null);

  const goNext = () => setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  const goBack = () => {
    if (stepIndex === 0) {
      navigate("/login");
    } else {
      setStepIndex((i) => i - 1);
    }
  };

  const handleAccountCreated = (accountData) => {
    setAccount(accountData);
    goNext();
  };

  const handleFinish = () => {
    // NOTE: household/members/vulnerability steps are placeholders —
    // once they exist, submit their combined data to the backend here
    // (e.g. a single POST to /api/resident/register/complete/) before
    // sending the resident to their new dashboard.
    sessionStorage.setItem("geoaid_resident_mobile", account?.mobile_number || "");
    navigate("/home");
  };

  return (
    <MobileShell>
      <div className="register-screen">
        <header className="register-header">
          <button type="button" className="back-btn" onClick={goBack} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div>
            <h1>Register Household</h1>
            <p>Step {stepIndex + 1} of {STEPS.length} — {STEPS[stepIndex]} Setup</p>
          </div>
        </header>

        <StepProgress currentIndex={stepIndex} />

        <div className="register-body">
          {stepIndex === 0 && <AccountStep onContinue={handleAccountCreated} />}
          {stepIndex > 0 && (
            <StepStub
              {...STEP_COPY[stepIndex]}
              isLast={stepIndex === STEPS.length - 1}
              nextLabel={
                stepIndex === STEPS.length - 1
                  ? "Complete Registration"
                  : `Next: ${STEPS[stepIndex + 1]}`
              }
              onNext={stepIndex === STEPS.length - 1 ? handleFinish : goNext}
            />
          )}
        </div>
      </div>
    </MobileShell>
  );
}

export default Register;
