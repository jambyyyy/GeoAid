import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import MobileShell from "../../components/MobileShell";
import BrandMark from "../../components/BrandMark";
import "./Login.css";

function EyeIcon({ off }) {
  return off ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
      <path d="M6.5 6.7C4.4 8.1 2.9 10 2 12c1.6 3.6 5 7 10 7 1.8 0 3.4-.4 4.8-1.1M17.9 17.9C20 16.5 21.6 14.4 22 12c-1.2-2.7-3.5-5.4-7-6.6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A17.5 17.5 0 0 1 4.5 5.2 2 2 0 0 1 6.5 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Login() {
  const navigate = useNavigate();

  const [mobile, setMobile] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    const trimmedMobile = mobile.trim();
    if (!trimmedMobile) {
      setError("Please enter your mobile number.");
      return;
    }
    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch("http://127.0.0.1:8000/api/resident/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile_number: `+63${trimmedMobile}`,
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Invalid mobile number or password.");
        return;
      }

      sessionStorage.setItem("geoaid_resident_mobile", `+63${trimmedMobile}`);
      navigate("/home");
    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <MobileShell>
      <div className="login-screen">
        <BrandMark subtitle="Iligan City DRRM" />

        <h1 className="login-heading">Welcome back</h1>
        <p className="login-subheading">Sign in to access your household dashboard</p>

        <form onSubmit={handleSubmit} className="login-form">
          {error && <div className="form-error">{error}</div>}

          <label htmlFor="mobile">Mobile Number</label>
          <div className="mobile-input-wrap">
            <span className="mobile-prefix">+63</span>
            <input
              id="mobile"
              type="tel"
              placeholder="917 234 5678"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <label htmlFor="password">Password</label>
          <div className="password-input-wrap">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={isSubmitting}
            />
            <button
              type="button"
              className="eye-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              <EyeIcon off={showPassword} />
            </button>
          </div>

          <div className="forgot-row">
            <Link to="#" className="forgot-link">Forgot password?</Link>
          </div>

          <button type="submit" className="signin-btn" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign In"}
          </button>

          <div className="divider-row">
            <span />
            <p>or</p>
            <span />
          </div>

          <button type="button" className="otp-btn" disabled={isSubmitting}>
            <PhoneIcon /> Sign in with OTP
          </button>
        </form>

        <p className="register-footer">
          Not registered yet? <Link to="/register">Create account</Link>
        </p>
      </div>
    </MobileShell>
  );
}

export default Login;
