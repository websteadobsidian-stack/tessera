import { Route, Routes } from "react-router-dom";
import { Console } from "./Console";
import { Data } from "./Data";
import { Home } from "./Home";
import { Lab } from "./Lab";
import { Research } from "./Research";
import { FacilitatorShell } from "./Shell";

export default function FacilitatorRoutes() {
  return (
    <Routes>
      <Route element={<FacilitatorShell />}>
        <Route index element={<Home />} />
        <Route path="session/:team/:session" element={<Console />} />
        <Route path="lab" element={<Lab />} />
        <Route path="research" element={<Research />} />
        <Route path="data" element={<Data />} />
      </Route>
    </Routes>
  );
}
