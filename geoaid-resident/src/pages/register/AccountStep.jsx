import { useState } from "react";
import "./AccountStep.css";

function ShieldIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function AccountStep({ onContinue }) {
  const [fullName, setFullName] = useState("");
  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!fullName.trim()) {
      setError("Please enter your full name.");
      return;
    }
    if (!/^9\d{9}$/.test(mobile.trim())) {
      setError("Enter a valid mobile number (e.g. 9xx xxx xxxx).");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const payload = {
      full_name: fullName.trim(),
      mobile_number: `+63${mobile.trim()}`,
      password,
    };

    setIsSubmitting(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/resident/register/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.message || "Could not create the account. Please try again.");
        return;
      }

      onContinue({ ...payload, ...data });
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server. Make sure the Django backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="account-step" onSubmit={handleSubmit}>
      {error && <div className="form-error">{error}</div>}

      <label htmlFor="fullName">Full Name</label>
      <input
        id="fullName"
        type="text"
        placeholder="Maria Santos"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        disabled={isSubmitting}
      />

      <label htmlFor="mobile">Mobile Number</label>
      <div className="mobile-input-wrap">
        <span className="mobile-prefix">+63</span>
        <input
          id="mobile"
          type="tel"
          placeholder="9xx xxx xxxx"
          value={mobile}
          onChange={(e) => setMobile(e.target.value)}
          disabled={isSubmitting}
        />
      </div>

      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        placeholder="Min. 8 characters"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        disabled={isSubmitting}
      />

      <label htmlFor="confirmPassword">Confirm Password</label>
      <input
        id="confirmPassword"
        type="password"
        placeholder="Repeat password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        disabled={isSubmitting}
      />

      <div className="privacy-note">
        <ShieldIcon />
        <p>
          Your data is protected under the Philippine Data Privacy Act (RA 10173). Information is
          only shared with Iligan City LGU agencies.
        </p>
      </div>

      <button type="submit" className="continue-btn" disabled={isSubmitting}>
        {isSubmitting ? "Creating account..." : "Continue"}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </form>
  );
}

export default AccountStep;
