import { useEffect, useMemo, useState } from "react";
import { Copy, Lock, Plus, Save, Trash } from "lucide-react";
import { api } from "../lib/api";
import { num } from "../lib/format";
import { useLive } from "../lib/live";
import type { Catalog, Mechanics, Protocol } from "../lib/types";
import { Empty, Loader, Segmented, Switch } from "../ui/core";
import { NumberField } from "../ui/fields";
import { Confirm, useAction } from "../ui/overlays";
import { MiniTimeline, TimelineEditor } from "./timeline";
import { useProtocols } from "./Home";
import { PageHead, useFacilitator } from "./Shell";

type Draft = { protocol_id: string | null; title: string; description: string; builtin: boolean; config: Protocol["config"] };

export function Lab() {
  const { token } = useFacilitator();
  const { protocols, reload } = useProtocols();
  const { data: catalog } = useLive<Catalog>(null, (signal) => api("/api/admin/catalog", { token, signal }));
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (!protocols.length) return;
    const p = protocols.find((x) => x.protocol_id === selected) ?? (selected === null ? protocols[0] : null);
    if (p) setDraft({ protocol_id: p.protocol_id, title: p.title, description: p.description, builtin: p.builtin, config: structuredClone(p.config) });
  }, [protocols, selected]);

  const copyOf = (p: Draft) => setDraft({ ...structuredClone(p), protocol_id: null, builtin: false, title: `${p.title} — копия` });

  if (!catalog || !protocols.length) return <main className="page"><Loader /></main>;
  return (
    <main className="page wide stack xl">
      <PageHead eyebrow="Лаборатория" title="Протоколы экспериментов"
        lead="Протокол — это набор механик и таймлайн вмешательств. Команды, созданные по протоколу, получают его снимок: так условия эксперимента не «поплывут» посреди исследования." />
      <div className="lab">
        <aside className="stack sm">
          {protocols.map((p) => (
            <button key={p.protocol_id} className={`proto-card ${draft?.protocol_id === p.protocol_id ? "on" : ""}`} onClick={() => setSelected(p.protocol_id)}>
              <div className="row between"><strong>{p.title}</strong>{p.builtin && <Lock size={13} color="var(--ink-3)" />}</div>
              <span className="tiny muted">{Object.values(p.config.mechanics).filter(Boolean).length} механик · {p.config.work_minutes} мин · {p.config.timeline.length} событий{p.config.time_scale !== 1 ? ` · ×${num(p.config.time_scale, 2)}` : ""}</span>
              <MiniTimeline config={p.config} />
              {p.teams > 0 && <span className="tiny muted">команд: {p.teams}</span>}
            </button>
          ))}
          <button className="btn block" onClick={() => draft && copyOf(draft)}><Plus size={15} />Новый на основе выбранного</button>
        </aside>
        {draft ? <Editor key={draft.protocol_id ?? "new"} draft={draft} setDraft={setDraft} catalog={catalog}
          onSaved={async (id) => { await reload(); setSelected(id); }} onCopy={() => copyOf(draft)} /> : <Empty title="Выберите протокол" />}
      </div>
    </main>
  );
}

function Editor({ draft, setDraft, catalog, onSaved, onCopy }: {
  draft: Draft; setDraft: (d: Draft) => void; catalog: Catalog; onSaved: (id: string) => Promise<void>; onCopy: () => void;
}) {
  const { token } = useFacilitator();
  const { run, busy } = useAction();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ro = draft.builtin;
  const cfg = draft.config;
  const set = (patch: Partial<Protocol["config"]>) => setDraft({ ...draft, config: { ...cfg, ...patch } });
  const setMech = (k: keyof Mechanics, v: boolean) => set({ mechanics: { ...cfg.mechanics, [k]: v } });
  const groups = useMemo(() => {
    const out: Record<string, Catalog["mechanics"]> = {};
    for (const m of catalog.mechanics) (out[m.group] ??= []).push(m);
    return out;
  }, [catalog]);
  const payload = { title: draft.title, description: draft.description, config: cfg };

  const save = () => run(async () => {
    if (draft.protocol_id) {
      await api(`/api/admin/protocols/${draft.protocol_id}`, { method: "PUT", token, body: payload });
      await onSaved(draft.protocol_id);
    } else {
      const r = await api<{ protocol_id: string }>("/api/admin/protocols", { method: "POST", token, body: payload });
      await onSaved(r.protocol_id);
    }
  }, "Протокол сохранён");

  return (
    <div className="stack lg" style={{ minWidth: 0 }}>
      <div className="panel stack lg">
        {ro && <div className="notice"><span className="ico"><Lock size={15} /></span><div className="grow"><div className="title">Встроенный протокол</div><div className="body">Его нельзя менять — сделайте копию и настройте под свой эксперимент.</div></div>
          <button className="btn sm primary" onClick={onCopy}><Copy size={14} />Сделать копию</button></div>}
        <div className="grid-2">
          <div className="field"><label>Название</label><input className="input" value={draft.title} disabled={ro} maxLength={80} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></div>
          <div className="field"><label>Описание</label><input className="input" value={draft.description} disabled={ro} maxLength={600} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
        </div>
        <div className="grid-4">
          <div className="field"><label>Работа</label>
            <NumberField label="Длительность работы" value={cfg.work_minutes} onChange={(v) => set({ work_minutes: v })} min={5} max={240} step={5} suffix="мин" disabled={ro} /></div>
          <div className="field"><label>Лимит WIP</label>
            <NumberField label="Лимит WIP" value={cfg.wip_limit} onChange={(v) => set({ wip_limit: v })} min={1} max={20} suffix="на этап" disabled={ro} /></div>
          <div className="field"><label>Спринт</label>
            <NumberField label="Длина спринта" value={cfg.sprint_minutes} onChange={(v) => set({ sprint_minutes: v })} min={3} max={120} suffix="мин" disabled={ro} /></div>
          <div className="field"><label>Масштаб времени</label>
            <Segmented value={String(cfg.time_scale)} onChange={(v) => !ro && set({ time_scale: Number(v) })}
              items={["0.25", "0.5", "1"].map((v) => ({ key: v, title: `×${v.replace(".", ",")}` }))} /></div>
        </div>
        <span className="tiny muted">Масштаб сжимает время: при ×0,25 пятидесятиминутная работа идёт 12,5 минут, а минуты таймлайна пересчитываются. Удобно для демо и пилотов.</span>
      </div>

      <div className="panel stack lg">
        <h3>Механики</h3>
        <div className="mech-groups">
          {Object.entries(groups).map(([g, items]) => (
            <div key={g} className="stack sm">
              <span className="eyebrow">{g}</span>
              {items.map((m) => (
                <label key={m.key} className={`mech ${cfg.mechanics[m.key] ? "on" : ""}`}>
                  <div className="stack xs grow"><strong className="small">{m.title}</strong><span className="tiny muted">{m.text}</span></div>
                  <Switch checked={!!cfg.mechanics[m.key]} disabled={ro} label={m.title} onChange={(v) => setMech(m.key, v)} />
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="panel stack lg">
        <div className="stack xs">
          <h3>Таймлайн вмешательств</h3>
          <span className="small muted">Срабатывает сам по минутам рабочей фазы. Ведущий видит его на пульте и может запустить событие раньше или пропустить.</span>
        </div>
        <TimelineEditor timeline={cfg.timeline} workMinutes={cfg.work_minutes} catalog={catalog} readOnly={ro} onChange={(timeline) => set({ timeline })} />
      </div>

      {!ro && (
        <div className="row between wrap">
          <div className="row">
            <button className="btn primary" disabled={busy || draft.title.trim().length < 2} onClick={() => void save()}><Save size={16} />{draft.protocol_id ? "Сохранить" : "Создать протокол"}</button>
            {draft.protocol_id && <button className="btn" onClick={onCopy}><Copy size={15} />Копия</button>}
          </div>
          {draft.protocol_id && <button className="btn danger" onClick={() => setConfirmDelete(true)}><Trash size={15} />Удалить</button>}
        </div>
      )}
      <Confirm open={confirmDelete} onClose={() => setConfirmDelete(false)} danger confirm="Удалить" title="Удалить протокол?"
        text="Протокол, по которому уже работали команды, удалить нельзя — это часть истории исследования."
        onConfirm={() => run(async () => {
          await api(`/api/admin/protocols/${draft.protocol_id}`, { method: "DELETE", token });
          await onSaved("standard");
        }, "Удалено")} />
    </div>
  );
}
