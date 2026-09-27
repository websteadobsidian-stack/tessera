import "@fontsource-variable/onest";
import "@fontsource-variable/unbounded";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui.css";
import "./styles/charts.css";
import "./styles/board.css";
import "./styles/participant.css";
import "./styles/facilitator.css";
import "./styles/stage.css";
import "./styles/landing.css";
import "./styles/polish.css";

import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Loader, useTheme } from "./ui/core";
import { ToastProvider } from "./ui/overlays";

const Landing = lazy(() => import("./pages/Landing"));
const Join = lazy(() => import("./pages/Join"));
const Play = lazy(() => import("./participant/Play"));
const Stage = lazy(() => import("./stage/Stage"));
const Facilitator = lazy(() => import("./facilitator/routes"));

function App() {
  useTheme();
  return (
    <Suspense fallback={<main className="page narrow"><Loader /></main>}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/play" element={<Play />} />
        <Route path="/stage/:team/:session" element={<Stage />} />
        <Route path="/facilitator/*" element={<Facilitator />} />
        <Route path="/admin/*" element={<Navigate to="/facilitator" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
