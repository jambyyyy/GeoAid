import { useState } from "react";
import { useNavigate } from "react-router-dom";
import "./login.css";
import hero from "../../assets/images/iligan_city.jpg";
import cityLogo from "../../assets/images/logo.jpg";

function UserIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M4 20c0-3.314 3.582-6 8-6s8 2.686 8 6"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        d="M8 11V8a4 4 0 1 1 8 0v3"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function ArrowLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M19 12H5M11 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function RoleIcon() {
  return (
    <svg className="input-icon" viewBox="0 0 24 24" fill="none">
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <circle cx="9" cy="10.5" r="1.75" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M6.5 15c.6-1.4 1.8-2 2.5-2s1.9.6 2.5 2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M14 9h4M14 12h4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="select-chevron" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6l8-4Z"
        stroke="currentColor"
        strokeWidth="1.75"
      />
    </svg>
  );
}

function Login() {
  const navigate = useNavigate();

  const rememberedUsername =
    localStorage.getItem("geoaid_remember") ?? "";

  const [role, setRole] = useState("");
  const [username, setUsername] = useState(rememberedUsername);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    Boolean(rememberedUsername)
  );
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setError("");

    if (!role) {
      setError("Please select a role.");
      return;
    }

    const trimmedUsername = username.trim();

    if (!trimmedUsername) {
      setError("Please enter your username.");
      return;
    }

    if (!password) {
      setError("Please enter your password.");
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch(
        "http://127.0.0.1:8000/api/login/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username: trimmedUsername,
            password: password,
            role: role,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        setError(
          data.message || "Invalid username or password."
        );
        return;
      }

      if (rememberMe) {
        localStorage.setItem(
          "geoaid_remember",
          trimmedUsername
        );
      } else {
        localStorage.removeItem("geoaid_remember");
      }

      // Use the role the SERVER determined from the account's actual
      // group, not the value the user picked in the dropdown. The
      // dropdown is only used to ask the server "is this account
      // supposed to log in as X?" — the response is authoritative.
      const confirmedRole = data.role;

      sessionStorage.setItem(
        "geoaid_user",
        data.username
      );

      sessionStorage.setItem(
        "geoaid_role",
        confirmedRole
      );

      // Redirect according to the confirmed role
      if (confirmedRole === "barangay") {
        navigate("/dashboard");
      } else if (confirmedRole === "cswd") {
        navigate("/cswd-dashboard");
      } else if (confirmedRole === "drrm") {
        navigate("/drrm-dashboard");
      } else if (confirmedRole === "purok") {
        navigate("/purok-dashboard");
      } else {
        setError("Your account isn't assigned to a recognized role. Please contact an administrator.");
      }

    } catch (err) {
      console.error(err);
      setError("Unable to connect to the server.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="login-page">
      <div
        className="login-hero"
        style={{ backgroundImage: `url(${hero})` }}
      >
        <div className="overlay"></div>

        <div className="hero-back">
          <button
            type="button"
            className="back-home-link"
            onClick={() => navigate("/")}
          >
            <ArrowLeftIcon />
            Back to home
          </button>
        </div>

        <div className="hero-content">
          <div className="brand-lockup">
            <img
              src={cityLogo}
              alt="City of Iligan Official Seal"
              className="city-seal"
            />

            <div className="brand-text">
              <span className="brand-name">
                Geo<span className="accent">Aid</span>
              </span>

              <span className="brand-subtitle">
                Disaster Management System
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="login-panel">
        <div className="login-card">

          <div className="login-card-icon">
            <ShieldIcon />
          </div>

          <h2>Welcome Back</h2>

          <span className="subtitle">
            Sign in to continue to your account
          </span>

          <form onSubmit={handleSubmit}>

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}

            {/* ROLE */}
            <label htmlFor="role">Role</label>

            <div className="input-wrap">
              <RoleIcon />

              <select
                id="role"
                className="role-select"
                value={role}
                onChange={(e) =>
                  setRole(e.target.value)
                }
                disabled={isSubmitting}
              >
                <option value="">
                  Select Role
                </option>

                <option value="barangay">
                  Barangay Staff
                </option>

                <option value="cswd">
                  CSWD
                </option>

                <option value="drrm">
                  DRRM Officer
                </option>

                <option value="purok">
                  Purok President
                </option>
              </select>

              <ChevronDownIcon />
            </div>

            <label htmlFor="username">
              Username
            </label>

            <div className="input-wrap">
              <UserIcon />

              <input
                id="username"
                type="text"
                placeholder="Enter your username"
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value)
                }
              />
            </div>

            <label htmlFor="password">
              Password
            </label>

            <div className="input-wrap">
              <LockIcon />

              <input
                id="password"
                type={
                  showPassword
                    ? "text"
                    : "password"
                }
                placeholder="Enter your password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
              />

              <button
                type="button"
                className="toggle-visibility"
                onClick={() =>
                  setShowPassword(
                    !showPassword
                  )
                }
              >
                {showPassword
                  ? "Hide"
                  : "Show"}
              </button>
            </div>

            <div className="row-between">
              <label className="remember">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) =>
                    setRememberMe(
                      e.target.checked
                    )
                  }
                />
                <span>Remember me</span>
              </label>
            </div>

            <button
              type="submit"
              className="submit-btn"
              disabled={isSubmitting}
            >
              {isSubmitting
                ? "Signing in..."
                : "Login"}
            </button>

          </form>
        </div>
      </div>
    </div>
  );
}

export default Login;