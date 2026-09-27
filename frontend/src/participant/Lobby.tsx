import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "../lib/api";
import { capitalize, shortName } from "../lib/people";
import type { Debrief } from "../lib/types";
import { SynergyCard } from "../charts/Insights";
import { Mosaic } from "../mosaic/Mosaic";
import { KudosIcon, Loader, PersonTile } from "../ui/core";
import { TileBurst } from "../ui/effects";
import { usePlay } from "./context";
import { FragmentCard } from "./Debrief";

export function Lobby() {
  const { state, me } = usePlay();
  const total = Math.max(state.roster.length, 5);
  return (
    <main className="page narrow stack xl" style={{ paddingTop: 48 }}>
      <div className="stack">
        <span className="eyebrow">Сбор команды</span>
        <h1>Команда собирается</h1>
        <p className="soft" style={{ fontSize: 17 }}>Как только все будут на месте, ведущий начнёт. Экран переключится сам.</p>
      </div>
      <div className="panel" style={{ padding: 28 }}>
        <div className="grid-3" style={{ gap: 14 }}>
          <AnimatePresence>
            {state.roster.map((p, i) => (
              <motion.div key={p.participant_id} className="row" style={{ gap: 14 }}
                initial={{ opacity: 0, scale: 0.6, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 18, delay: i * 0.05 }}>
                <PersonTile person={p} size="xl" online={p.online} />
                <div className="stack xs">
                  <strong style={{ fontSize: 16 }}>{shortName(p)}{p.participant_id === me.participant_id && <span className="muted"> · вы</span>}</strong>
                  <span className="small muted">{capitalize(p.role_title)}</span>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          {Array.from({ length: Math.max(0, total - state.roster.length) }, (_, i) => (
            <div key={`e${i}`} className="row" style={{ gap: 14, opacity: 0.35 }}>
              <span className="tile xl" style={{ ["--c" as string]: "var(--glass-3)", boxShadow: "none" }} />
              <span className="small muted">ждём…</span>
            </div>
          ))}
        </div>
      </div>
      <p className="small muted center">Пока ждём — расскажите соседям по столу, кто вы по роли в «{state.company.title}».</p>
    </main>
  );
}

export function Closed() {
  const { state, token, me } = usePlay();
  const [data, setData] = useState<Debrief | null>(null);
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    api<Debrief>("/api/p/debrief", { token }).then((d) => { setData(d); setBurst(Date.now()); }).catch(() => undefined);
  }, [token]);
  if (!data) return <main className="page narrow"><Loader label="Собираем портрет команды…" /></main>;
  const people = data.people.map((p) => ({ ...p, role_title: p.role }));
  return (
    <main className="page stack xl">
      <TileBurst trigger={burst} count={60} />
      <div className="stack" style={{ textAlign: "center", alignItems: "center", paddingTop: 20 }}>
        <span className="eyebrow">Сессия завершена</span>
        <h1 className="gradient-text">Каждый — фрагмент. Вместе — картина.</h1>
        <p className="soft" style={{ fontSize: 17, maxWidth: 620 }}>Это портрет вашей команды: каждая плитка — действие одного из вас. Двухцветные — моменты, когда вы работали вместе.</p>
      </div>
      <div className="panel" style={{ padding: 28 }}>
        <Mosaic tiles={data.tiles} people={people} size={520} exportName={`tessera-${state.team.team_id}-${state.session.session_id}.png`} highlight={null} />
      </div>
      {data.personal && <FragmentCard personal={data.personal} people={people} meSlot={me.color_slot} tiles={data.tiles} actual={data.forecast.actual_tasks} />}
      <div className="grid-2" style={{ alignItems: "start" }}>
        <div className="panel stack lg">
          <SynergyCard synergy={data.synergy} />
          {data.achievements.length > 0 && (
            <div className="row wrap" style={{ gap: 8 }}>
              {data.achievements.map((a) => <span key={a.key} className="chip lg gold" title={a.text}>★ {a.title}</span>)}
            </div>
          )}
        </div>
        {data.agreements.items.length > 0 || data.retro.length > 0 ? (
          <div className="panel stack">
            <h3>Договорённости на следующий раз</h3>
            {(data.agreements.items.length ? data.agreements.items.map((a) => a.body) : data.retro.slice(0, 3).map((r) => r.body)).map((b, i) => (
              <div key={i} className="fact shared"><span className="bar-v" style={{ background: "var(--accent)" }} />{b}</div>
            ))}
            <span className="tiny muted">Вы увидите их на брифинге следующей сессии.</span>
          </div>
        ) : null}
      </div>
      {data.personal && Object.keys(data.personal.kudos_by_kind).length > 0 && (
        <div className="panel stack">
          <h3>Вас благодарили</h3>
          <div className="row wrap" style={{ gap: 10 }}>
            {Object.entries(data.personal.kudos_by_kind).map(([k, n]) => (
              <span key={k} className="chip lg"><KudosIcon kind={k} size={14} />{state.scenario.kudos.find((x) => x.id === k)?.title} · {n}</span>
            ))}
          </div>
          {data.personal.kudos_notes.map((n, i) => <p key={i} className="soft">«{n}»</p>)}
        </div>
      )}
      <p className="center tiny muted"><Download size={12} style={{ display: "inline", verticalAlign: "-2px" }} /> Портрет можно скачать — кнопка под мозаикой.</p>
    </main>
  );
}
