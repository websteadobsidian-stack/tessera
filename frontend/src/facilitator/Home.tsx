import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Activity, Boxes, Copy, MonitorPlay, Plus, Radio, Shuffle, Sparkles, Users } from "lucide-react";
import { api } from "../lib/api";
import { CONDITIONS, ago, condColor, conditionTitle, phaseTitle } from "../lib/format";
import { useLive } from "../lib/live";
import type { Condition, Phase, Protocol } from "../lib/types";
import { Empty, Loader, Segmented } from "../ui/core";
import { NumberField } from "../ui/fields";
import { Modal, useAction, useToast } from "../ui/overlays";
import { Select } from "../ui/select";
import { MiniTimeline } from "./timeline";
import { PageHead, useFacilitator } from "./Shell";

interface OverviewSession { team_id: string; session_id: string; phase: Phase; phase_changed_at: string; work_started_at: string | null; work_minutes: number; events: number; done: number; tasks: number }
interface OverviewTeam {
  team_id: string; join_code: string; condition: Condition; label: string; scenario_version: string; created_at: string;
  protocol_id: string | null; protocol_title: string | null; is_demo: boolean; demo_kind: string | null; participants: number;
  sessions: OverviewSession[];
}

export function Home() {
  const { token, full } = useFacilitator();
  const { data, reload } = useLive<{ teams: OverviewTeam[]; now: string }>(token,
    (signal) => api("/api/admin/overview", { token, signal }), { fallbackMs: 30000, debounceMs: 1500 });
  const [filter, setFilter] = useState<"active" | "all" | "demo">("active");
  const [modal, setModal] = useState<null | "team" | "batch">(null);

  const teams = useMemo(() => {
    const all = data?.teams ?? [];
    if (filter === "demo") return all.filter((t) => t.is_demo);
    if (filter === "active") return all.filter((t) => !t.is_demo && t.sessions.some((s) => s.phase !== "closed"));
    return all.filter((t) => !t.is_demo);
  }, [data, filter]);
  const live = (data?.teams ?? []).filter((t) => !t.is_demo && t.sessions.some((s) => s.phase === "work")).length;

  return (
    <main className="page wide stack xl">
      <PageHead eyebrow="Кабинет ведущего" title="Сессии" lead="Команды, коды для входа и живые сессии. Пульт открывается кликом по карточке.">
        {full && <button className="btn" onClick={() => setModal("batch")}><Shuffle size={16} />Серия команд</button>}
        {full && <button className="btn primary" onClick={() => setModal("team")}><Plus size={16} />Новая команда</button>}
      </PageHead>
      <div className="row between wrap">
        <Segmented value={filter} onChange={setFilter} items={[
          { key: "active", title: "Идут сейчас" }, { key: "all", title: "Все команды" }, { key: "demo", title: "Демо" },
        ]} />
        {live > 0 && <span className="chip lg good"><Radio size={13} />в работе: {live}</span>}
      </div>
      {!data ? <Loader /> : teams.length === 0 ? (
        <div className="panel">
          <Empty title={filter === "active" ? "Сейчас ничего не идёт" : "Команд пока нет"}>
            {full ? <>Создайте команду — участники войдут по коду. Или откройте «Данные», чтобы засеять демо-историю и посмотреть, как всё выглядит.</>
              : "Здесь появятся команды."}
            {full && <div className="row" style={{ justifyContent: "center", marginTop: 16 }}>
              <button className="btn primary" onClick={() => setModal("team")}><Plus size={16} />Новая команда</button>
              <Link className="btn" to="/facilitator/data"><Sparkles size={16} />Демо-данные</Link>
            </div>}
          </Empty>
        </div>
      ) : (
        <div className="team-grid">
          {teams.map((t, i) => <TeamCard key={t.team_id} team={t} index={i} now={data.now} onChanged={reload} />)}
        </div>
      )}
      <NewTeamModal open={modal === "team"} onClose={() => setModal(null)} onCreated={reload} />
      <BatchModal open={modal === "batch"} onClose={() => setModal(null)} onCreated={reload} />
    </main>
  );
}

function TeamCard({ team: t, index, now, onChanged }: { team: OverviewTeam; index: number; now: string; onChanged: () => void }) {
  const { token } = useFacilitator();
  const navigate = useNavigate();
  const toast = useToast();
  const { run, busy } = useAction();
  const last = t.sessions[t.sessions.length - 1];
  const progress = last && last.tasks ? last.done / last.tasks : 0;
  const url = last ? `/facilitator/session/${t.team_id}/${last.session_id}` : null;
  return (
    <motion.article className="team-card" style={{ ["--cc" as string]: condColor(t.condition) }}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 10) * 0.035 }}
      onClick={() => url && navigate(url)} role="link" tabIndex={0} onKeyDown={(e) => e.key === "Enter" && url && navigate(url)}>
      <div className="row between top">
        <div className="stack xs" style={{ minWidth: 0 }}>
          <span className="row tight tiny" style={{ color: "var(--cc)", fontWeight: 700 }}><span className="swatch" style={{ background: "var(--cc)" }} />{conditionTitle(t.condition)}</span>
          <h3 className="ellipsis">{t.label || t.team_id}</h3>
          <span className="tiny muted">{t.team_id} · {t.protocol_title ?? "протокол"}{t.is_demo ? ` · демо (${t.demo_kind === "sandbox" ? "песочница" : "история"})` : ""}</span>
        </div>
        <button className="code-pill" title="Скопировать код" onClick={(e) => { e.stopPropagation(); void navigator.clipboard?.writeText(t.join_code); toast("Код скопирован"); }}>
          {t.join_code}<Copy size={12} />
        </button>
      </div>
      {last && (
        <div className="stack sm">
          <div className="row between small">
            <span className={`chip ${last.phase === "work" ? "good" : last.phase === "closed" ? "" : "accent"}`}>
              {last.phase === "work" && <Radio size={11} />}{last.session_id} · {phaseTitle(last.phase)}
            </span>
            <span className="tiny muted">{ago(last.phase_changed_at, new Date(now).getTime())}</span>
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="bar grow"><span style={{ width: `${progress * 100}%`, background: "var(--cc)" }} /></div>
            <span className="tiny muted nowrap">{last.done}/{last.tasks} задач</span>
          </div>
        </div>
      )}
      <div className="row between">
        <span className="row tight small soft"><Users size={14} />{t.participants}<Activity size={14} style={{ marginLeft: 8 }} />{last?.events ?? 0}</span>
        <div className="row tight" onClick={(e) => e.stopPropagation()}>
          {t.sessions.length > 1 && (
            <Select label="Сессии команды" size="sm" value={null} placeholder={`${t.sessions.length} сессии`} style={{ width: 118 }} menuWidth={230}
              options={t.sessions.map((s) => ({ value: s.session_id, label: s.session_id, hint: `${phaseTitle(s.phase)} · ${s.done}/${s.tasks} задач`,
                icon: <span className="dot-ico" style={{ background: s.phase === "closed" ? "var(--ink-3)" : s.phase === "work" ? "var(--good)" : "var(--accent)" }} /> }))}
              onChange={(v) => navigate(`/facilitator/session/${t.team_id}/${v}`)} />
          )}
          {last?.phase === "closed" && (
            <button className="btn xs icon" disabled={busy} title="Новая сессия этой команды" aria-label="Новая сессия" onClick={() => run(async () => {
              const r = await api<{ session_id: string }>(`/api/admin/teams/${t.team_id}/sessions`, { method: "POST", token });
              onChanged();
              navigate(`/facilitator/session/${t.team_id}/${r.session_id}`);
            })}><Plus size={13} /></button>
          )}
          {last && <Link className="btn xs icon" to={`/stage/${t.team_id}/${last.session_id}`} target="_blank" title="Проектор" aria-label="Проектор"><MonitorPlay size={13} /></Link>}
        </div>
      </div>
    </motion.article>
  );
}

export function useProtocols() {
  const { token } = useFacilitator();
  const { data, reload } = useLive<Protocol[]>(null,
    (signal) => api<{ protocols: Protocol[] }>("/api/admin/protocols", { token, signal }).then((r) => r.protocols));
  return { protocols: data ?? [], reload };
}

/** Протокол с описанием и числом механик — чтобы выбирать осознанно. */
export function ProtocolSelect({ protocols, value, onChange }: { protocols: Protocol[]; value: string; onChange: (v: string) => void }) {
  return (
    <Select label="Протокол" value={value} onChange={onChange} showHint menuWidth={380}
      options={protocols.map((p) => ({
        value: p.protocol_id, label: p.title, text: `${p.title} ${p.description}`,
        hint: `${Object.values(p.config.mechanics).filter(Boolean).length} механик · ${p.config.timeline.length} событий в таймлайне${p.config.time_scale !== 1 ? ` · время ×${p.config.time_scale}` : ""}`,
        icon: <MiniTimeline config={p.config} />,
      }))} />
  );
}

function ConditionPicker({ value, onChange }: { value: Condition; onChange: (c: Condition) => void }) {
  return (
    <div className="cond-grid">
      {CONDITIONS.map((c) => (
        <button key={c.key} type="button" className="cond-card" aria-pressed={value === c.key} style={{ ["--cc" as string]: condColor(c.key) }} onClick={() => onChange(c.key)}>
          <span className="swatch" style={{ background: "var(--cc)", width: 12, height: 12, borderRadius: 4 }} />
          <strong>{c.title}</strong>
          <span className="tiny muted">{c.blurb}</span>
        </button>
      ))}
    </div>
  );
}

function NewTeamModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { token } = useFacilitator();
  const navigate = useNavigate();
  const { protocols } = useProtocols();
  const [condition, setCondition] = useState<Condition>("kanban");
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState("standard");
  const { run, busy } = useAction();
  return (
    <Modal open={open} onClose={onClose} wide>
      <div className="stack lg">
        <div className="stack xs"><h2 style={{ fontSize: 24 }}>Новая команда</h2><span className="small muted">Участники войдут по шестизначному коду или QR с проектора.</span></div>
        <ConditionPicker value={condition} onChange={setCondition} />
        <div className="grid-2">
          <div className="field"><label>Название <span className="muted">(для вас)</span></label>
            <input className="input" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} placeholder="Например: Группа 3 · вторник" /></div>
          <div className="field"><label>Протокол</label>
            <ProtocolSelect protocols={protocols} value={protocol} onChange={setProtocol} /></div>
        </div>
        <div className="row end">
          <button className="btn ghost" onClick={onClose}>Отмена</button>
          <button className="btn primary" disabled={busy} onClick={() => run(async () => {
            const r = await api<{ team_id: string; session_id: string; join_code: string }>("/api/admin/teams", { method: "POST", token, body: { condition, label, protocol_id: protocol } });
            onCreated(); onClose();
            navigate(`/facilitator/session/${r.team_id}/${r.session_id}`);
          }, "Команда создана")}><Plus size={16} />Создать и открыть пульт</button>
        </div>
      </div>
    </Modal>
  );
}

function BatchModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const { token } = useFacilitator();
  const { protocols } = useProtocols();
  const [count, setCount] = useState(8);
  const [label, setLabel] = useState("");
  const [protocol, setProtocol] = useState("standard");
  const [conds, setConds] = useState<Condition[]>(["kanban", "sprints", "hierarchy", "self_org"]);
  const [seed, setSeed] = useState("");
  const [result, setResult] = useState<{ team_id: string; join_code: string; condition: Condition }[] | null>(null);
  const { run, busy } = useAction();
  const toggle = (c: Condition) => setConds((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const close = () => { setResult(null); onClose(); };
  return (
    <Modal open={open} onClose={close} wide>
      {result ? (
        <div className="stack lg">
          <div className="stack xs"><h2 style={{ fontSize: 24 }}>Серия создана</h2><span className="small muted">Условия распределены блоками: в каждом блоке каждая методика встречается один раз.</span></div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>№</th><th>Команда</th><th>Методика</th><th>Код</th></tr></thead>
              <tbody>{result.map((t, i) => (
                <tr key={t.team_id}><td className="mono">{i + 1}</td><td className="mono">{t.team_id}</td>
                  <td><span className="row tight"><span className="swatch" style={{ background: condColor(t.condition) }} />{conditionTitle(t.condition)}</span></td>
                  <td className="mono strong" style={{ fontSize: 16, letterSpacing: "0.08em" }}>{t.join_code}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <div className="row end"><button className="btn ghost" onClick={() => window.print()}>Печать</button><button className="btn primary" onClick={close}>Готово</button></div>
        </div>
      ) : (
        <div className="stack lg">
          <div className="stack xs"><h2 style={{ fontSize: 24 }}>Серия команд</h2>
            <span className="small muted">Для эксперимента: несколько команд сразу с блочной рандомизацией условий.</span></div>
          <div className="grid-3">
            <div className="field"><label>Сколько команд</label>
              <NumberField label="Сколько команд" value={count} onChange={setCount} min={1} max={40} width="100%" /></div>
            <div className="field"><label>Подпись серии</label>
              <input className="input" value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} placeholder="Поток А" /></div>
            <div className="field"><label>Протокол</label>
              <ProtocolSelect protocols={protocols} value={protocol} onChange={setProtocol} /></div>
          </div>
          <div className="stack sm">
            <span className="label">Какие методики сравниваем</span>
            <div className="row wrap tight">
              {CONDITIONS.map((c) => (
                <button key={c.key} className="chip lg" aria-pressed={conds.includes(c.key)} onClick={() => toggle(c.key)}
                  style={{ cursor: "pointer", ...(conds.includes(c.key) ? { background: condColor(c.key), color: "#fff", borderColor: "transparent" } : {}) }}>
                  {c.title}
                </button>
              ))}
            </div>
          </div>
          <div className="field" style={{ maxWidth: 260 }}><label>Зерно рандомизации <span className="muted">(необязательно)</span></label>
            <input className="input mono" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="например, 2026" /></div>
          <div className="row end">
            <button className="btn ghost" onClick={close}>Отмена</button>
            <button className="btn primary" disabled={busy || conds.length === 0} onClick={() => run(async () => {
              const r = await api<{ teams: { team_id: string; join_code: string; condition: Condition }[] }>("/api/admin/teams/batch", {
                method: "POST", token, body: { count, label, protocol_id: protocol, conditions: conds, seed: seed ? Number(seed) : null },
              });
              setResult(r.teams); onCreated();
            })}><Boxes size={16} />Создать {count}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
