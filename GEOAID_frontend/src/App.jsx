import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Landing from "./pages/landing/landing";
import Login from "./pages/login/login";

import Dashboard from "./pages/dashboard/dashboard";
import CSWDDashboard from "./pages/dashboard/CSWDDashboard";
import PurokDashboard from "./pages/dashboard/PurokDashboard";


function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Pages */}
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />

        {/* Barangay Staff */}
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
      </Routes>
    </BrowserRouter>
  );
}

export default App;