import "@fontsource-variable/onest";
import "@fontsource-variable/jetbrains-mono";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "./components/ui";
import { AdminHome, AdminLogin, RequireAdmin } from "./pages/Admin";
import AdminSession from "./pages/AdminSession";
import Landing from "./pages/Landing";
import Play from "./pages/Play";
import Research from "./pages/Research";

try {
  const theme = localStorage.getItem("tessera.theme");
  if (theme) document.documentElement.dataset.theme = theme;
} catch { /* без сохранённой темы */ }

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/play" element={<Play />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          <Route path="/admin" element={<RequireAdmin><AdminHome /></RequireAdmin>} />
          <Route path="/admin/s/:team/:session" element={<RequireAdmin><AdminSession /></RequireAdmin>} />
          <Route path="/admin/research" element={<RequireAdmin><Research /></RequireAdmin>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  </StrictMode>,
);
