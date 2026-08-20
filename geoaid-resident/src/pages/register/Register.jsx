import { useState } from "react";
import { useNavigate } from "react-router-dom";
import MobileShell from "../../components/MobileShell";
import StepProgress, { STEPS } from "../../components/StepProgress";
import AccountStep from "./AccountStep";
import HouseholdStep from "./HouseholdStep";
import MembersStep from "./MembersStep";
import VulnerabilityStep from "./VulnerabilityStep";
import { API_URL } from "../../config";
import "./Register.css";

function Register() {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);

  // Accumulated state across all 4 steps — sent to the backend as one
  // combined submission once Step 4 is completed.
  const [account, setAccount] = useState(null);
  const [household, setHousehold] = useState(null);
  const [members, setMembers] = useState(null);

  const [submitError, setSubmitError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  const handleHouseholdContinue = (householdData) => {
    setHousehold(householdData);
    goNext();
  };

  const handleMembersContinue = (membersData) => {
    setMembers(membersData);
    goNext();
  };

  const handleFinish = async ({ flags, isFourPs }) => {
    setSubmitError("");
    setIsSubmitting(true);

    const payload = {
      mobile_number: account?.mobile_number,
      barangay: household?.barangay,
      purok: household?.purok,
      address_line: household?.addressLine,
      landmark: household?.landmark,
      dwelling_type: household?.dwellingType,
      gps_lat: household?.gpsLat,
      gps_lng: household?.gpsLng,
      is_four_ps: isFourPs,
      members: members.map((m) => ({
        full_name: m.fullName,
        age: m.age,
        relation: m.relation,
        is_pwd: flags[m.id]?.isPwd || false,
        pwd_detail: flags[m.id]?.pwdDetail || "",
        is_pregnant: flags[m.id]?.isPregnant || false,
        pregnant_detail: flags[m.id]?.pregnantDetail || "",
      })),
    };

    try {
      const response = await fetch(`${API_URL}/api/resident/register/complete/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setSubmitError(data.message || "Could not finish registration. Please try again.");
        return;
      }

      // Registration is submitted but not yet reviewed by the Purok
      // President — don't sign the resident in yet. Send them to login
      // with a message; login_resident will keep rejecting them with a
      // "pending" status until a Purok President approves the household.
      navigate("/login", {
        state: {
          message:
            "Registration submitted! Your household is now pending review by your Purok President. You'll be able to log in once it's approved.",
        },
      });
    } catch (err) {
      console.error(err);
      setSubmitError("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsSubmitting(false);
    }
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
          {submitError && <div className="register-submit-error">{submitError}</div>}

          {stepIndex === 0 && <AccountStep onContinue={handleAccountCreated} />}

          {stepIndex === 1 && (
            <HouseholdStep initialValue={household} onContinue={handleHouseholdContinue} />
          )}

          {stepIndex === 2 && (
            <MembersStep
              headName={account?.full_name}
              initialValue={members}
              onContinue={handleMembersContinue}
              onBack={goBack}
            />
          )}

          {stepIndex === 3 && (
            <VulnerabilityStep
              members={members || []}
              onFinish={handleFinish}
              onBack={goBack}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </div>
    </MobileShell>
  );
}

export default Register;