import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Landing from "./pages/landing/landing";
import Login from "./pages/login/login";

import Dashboard from "./pages/dashboard/dashboard";
import CSWDDashboard from "./pages/dashboard/CSWDDashboard";
<<<<<<< HEAD
import DRRMDashboard from "./pages/dashboard/DRRMDashboard";
import PurokDashboard from "./pages/dashboard/PurokDashboard";

=======
import PurokDashboard from "./pages/dashboard/PurokDashboard";


>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Pages */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        {/* Barangay Staff */}
<<<<<<< HEAD
        <Route path="/dashboard" element={<Dashboard />} />

        {/* CSWD */}
        <Route path="/cswd-dashboard" element={<CSWDDashboard />} />

        {/* DRRM Officer */}
        <Route path="/drrm-dashboard" element={<DRRMDashboard />} />

        {/* Purok President */}
        <Route path="/purok-dashboard" element={<PurokDashboard />} />

        {/* Unknown Routes */}
        <Route path="*" element={<Navigate to="/" replace />} />
=======
        <Route
          path="/dashboard"
          element={<Dashboard />}
        />

        {/* CSWD */}
        <Route
          path="/cswd-dashboard"
          element={<CSWDDashboard />}
        />

        {/* Purok President */}
        <Route
          path="/purok-dashboard"
          element={<PurokDashboard />}
        />

        {/* Unknown Routes */}
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
>>>>>>> f89e8864a69568ed78c4e55d7e132ab5a9c271ca
      </Routes>
    </BrowserRouter>
  );
}

export default App;