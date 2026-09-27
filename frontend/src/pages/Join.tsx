import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Empty, Loader } from "../ui/core";
import { joinTeam } from "./Landing";

/** Вход по ссылке или QR: /join/КОД. */
export default function Join() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    joinTeam(code).then(() => navigate("/play", { replace: true })).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, navigate]);
  return (
    <main className="page narrow" style={{ paddingTop: 80 }}>
      {error ? (
        <div className="panel"><Empty title="Не получилось войти">{error}<div style={{ marginTop: 16 }}><Link className="btn primary" to="/">Ввести код вручную</Link></div></Empty></div>
      ) : <Loader label={`Входим в команду ${code.toUpperCase()}…`} />}
    </main>
  );
}
