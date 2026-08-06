import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import Register from "./pages/register/Register";
import Login from "./pages/login/Login";
import Home from "./pages/home/Home";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Residents land on registration first — this is the entry
            point that talks to the backend to create the household
            account. Existing/returning residents move on to Login. */}
        <Route path="/" element={<Navigate to="/register" replace />} />
        <Route path="/register" element={<Register />} />

        <Route path="/login" element={<Login />} />

        <Route path="/home" element={<Home />} />

        {/* Unknown routes */}
        <Route path="*" element={<Navigate to="/register" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
