import { motion } from "motion/react";
import { useMemo } from "react";
import { HeartHandshake, Radar, Star } from "lucide-react";
import type { Tile } from "../lib/types";
import { Mosaic } from "../mosaic/Mosaic";
import { PersonTile } from "../ui/core";

const PEOPLE = [
  { participant_id: "a", display_name: "Дина", role_title: "руководитель", color_slot: 5 },
  { participant_id: "b", display_name: "Лена", role_title: "аналитик", color_slot: 1 },
  { participant_id: "c", display_name: "Яна", role_title: "финансист", color_slot: 4 },
  { participant_id: "d", display_name: "Женя", role_title: "исполнитель", color_slot: 3 },
  { participant_id: "e", display_name: "Борис", role_title: "исполнитель", color_slot: 6 },
  { participant_id: "f", display_name: "Лиза", role_title: "контроль", color_slot: 2 },
];

/** Детерминированный «портрет» для витрины: те же виды плиток, что и в настоящем разборе. */
function sampleTiles(n = 150): Tile[] {
  let s = 20260927;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const ids = PEOPLE.map((p) => p.participant_id);
  const kinds: [string, number, boolean][] = [
    ["start", 22, false], ["handover", 22, true], ["done", 9, false], ["fact", 10, false], ["kudos", 9, true],
    ["helped", 6, true], ["message", 10, false], ["rework", 3, false], ["vote", 5, false],
  ];
  const total = kinds.reduce((a, k) => a + k[1], 0);
  const out: Tile[] = [];
  for (let i = 0; i < n; i++) {
    let r = rnd() * total;
    const kind = kinds.find((k) => (r -= k[1]) < 0) ?? kinds[0];
    const a = ids[Math.floor(rnd() * ids.length)];
    let b: string | undefined;
    if (kind[2]) { do b = ids[Math.floor(rnd() * ids.length)]; while (b === a); }
    out.push({ t: new Date(2026, 8, 27, 10, Math.floor(i / 3)).toISOString(), k: kind[0], a, b });
    if (i === 60 || i === 118) out.push({ t: out[out.length - 1].t, k: "achievement", a: null });
  }
  return out;
}

export function HeroPreview() {
  const tiles = useMemo(() => sampleTiles(), []);
  return (
    <div className="hero-preview" aria-hidden>
      <motion.div className="hp-frame" initial={{ opacity: 0, y: 30, rotateX: 8 }} animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 1, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}>
        <div className="hp-head">
          <span className="eyebrow">Портрет команды · 47 минут</span>
          <span className="hp-dots"><i /><i /><i /></span>
        </div>
        <Mosaic tiles={tiles} people={PEOPLE} size={400} showLegend={false} replayable={false} minCols={13} highlight={null} />
        <div className="hp-people">
          {PEOPLE.map((p) => <PersonTile key={p.participant_id} person={p} size="sm" />)}
          <span className="tiny muted">6 фрагментов — одна картина</span>
        </div>
      </motion.div>

      <motion.div className="hp-float hp-level" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.7, duration: 0.6 }}>
        <motion.div animate={{ y: [0, -6, 0] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} className="hp-card">
          <span className="lm-tiles"><i className="on" /><i className="on" /><i className="on" /><i className="on" /><i className="cur" /></span>
          <span className="stack xs" style={{ gap: 0 }}>
            <span className="tiny muted">Сыгранность</span>
            <strong className="display" style={{ fontSize: 18, letterSpacing: "-0.03em" }}>86 · Картина</strong>
          </span>
        </motion.div>
      </motion.div>

      <motion.div className="hp-float hp-kudos" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 1, duration: 0.6 }}>
        <motion.div animate={{ y: [0, 7, 0] }} transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }} className="hp-card">
          <span className="hp-ico" style={{ ["--c" as string]: "var(--p5)" }}><HeartHandshake size={17} /></span>
          <span className="stack xs" style={{ gap: 1 }}>
            <span className="small"><strong>Лена</strong> → <strong>Боря</strong></span>
            <span className="tiny soft">«Спасибо, что выложил факты!»</span>
          </span>
        </motion.div>
      </motion.div>

      <motion.div className="hp-float hp-sync" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1.3, duration: 0.6 }}>
        <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut", delay: 2 }} className="hp-card">
          <span className="hp-ico" style={{ ["--c" as string]: "var(--accent-strong)" }}><Radar size={17} /></span>
          <span className="stack xs" style={{ gap: 3 }}>
            <span className="tiny muted">Синхрон · где затор?</span>
            <span className="hp-bar"><span style={{ width: "83%" }} /></span>
            <span className="tiny"><strong>83%</strong> <span className="soft">видят одно и то же</span></span>
          </span>
        </motion.div>
      </motion.div>

      <motion.div className="hp-float hp-ach" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.6, type: "spring", stiffness: 200, damping: 14 }}>
        <span className="chip lg gold"><Star size={13} />Все карты на столе</span>
      </motion.div>
    </div>
  );
}
