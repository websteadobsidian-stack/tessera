import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, Eraser, FileArchive, FileSpreadsheet, Gamepad2, MessageSquareOff, Sparkles, Trash, UserX, Workflow } from "lucide-react";
import { TOKENS, api, download, store } from "../lib/api";
import { CONDITIONS, condColor } from "../lib/format";
import { useLive } from "../lib/live";
import { Loader, Segmented, Stat, Switch } from "../ui/core";
import { Confirm, useAction } from "../ui/overlays";
import { Select } from "../ui/select";
import { PageHead, useFacilitator } from "./Shell";

interface Status { names: number; messages: number; teams: number; demo_history: number; demo_sandbox: number; events: number }

const EXPORTS: { group: string; items: { name: string; title: string; text: string }[] }[] = [
  { group: "Журнал процесса", items: [
    { name: "events.csv", title: "События (CSV)", text: "Плоский журнал: кейс, активность, время, ресурс, роль, отдел, методика" },
    { name: "events.xes", title: "События (XES)", text: "Для ProM, Disco, pm4py — process mining" },
    { name: "events.ocel.json", title: "События (OCEL 2.0)", text: "Объектно-ориентированный журнал: задачи, вехи, участники" },
  ] },
  { group: "Опросы и оценки", items: [
    { name: "surveys.csv", title: "Опросы", text: "PS7, ясность целей, NASA-TLX, уверенность, Зеркало" },
    { name: "nominations.csv", title: "Выборы коллег", text: "К кому обращались за помощью, кто фактический лидер" },
    { name: "strengths.csv", title: "Сильные стороны", text: "Кто какую сильную сторону отметил у коллег" },
  ] },
  { group: "Механики взаимодействия", items: [
    { name: "fact_shares.csv", title: "Факты на столе", text: "Кто, что и когда выложил — скрытый профиль" },
    { name: "preferences.csv", title: "Личный выбор", text: "Выбор до обсуждения и уверенность" },
    { name: "votes.csv", title: "Голоса", text: "Все голоса, включая переголосования" },
    { name: "decisions.csv", title: "Решения", text: "Журнал решений с автором и обоснованием" },
    { name: "messages.csv", title: "Эфир (метаданные)", text: "Кто, кому, когда, длина; текст — если не стёрт" },
    { name: "help.csv", title: "Помощь", text: "Просьбы, отклики и время реакции" },
    { name: "kudos.csv", title: "Спасибо", text: "Кто кого и за что благодарил" },
    { name: "weather.csv", title: "Погода", text: "Самооценка состояния во времени" },
    { name: "probes.csv", title: "Синхрон", text: "Вопросы, ответы и правильные значения" },
  ] },
  { group: "Эксперименты и рефлексия", items: [
    { name: "sessions.csv", title: "Сессии", text: "Методика, протокол, время начала и конца" },
    { name: "participants.csv", title: "Участники", text: "Псевдонимы, роль, отдел, время согласия" },
    { name: "interventions.csv", title: "Вмешательства", text: "Тишина, выезды, смены ролей, подсказки — с источником" },
    { name: "injects.csv", title: "Вбросы", text: "События сценария" },
    { name: "charter.csv", title: "Договор команды", text: "Цель, правила решений, сигналы" },
    { name: "retro.csv", title: "Ретро", text: "Карточки и голоса" },
    { name: "agreements.csv", title: "Договорённости", text: "И как их оценили в следующий раз" },
    { name: "achievements.csv", title: "Достижения", text: "Когда команда их открыла" },
  ] },
];

const SANDBOX_ROLES = [
  { value: "pm", label: "Руководитель проекта", hint: "сроки, вехи, клиент" },
  { value: "analyst", label: "Аналитик", hint: "требования и задачи" },
  { value: "finance", label: "Финансист", hint: "бюджет и стоимость" },
  { value: "engineer", label: "Инженер", hint: "делает работу" },
  { value: "qa", label: "Контроль качества", hint: "принимает результат" },
];

export function Data() {
  const { token } = useFacilitator();
  const navigate = useNavigate();
  const { data: status, reload } = useLive<Status>(null, (signal) => api("/api/admin/data/status", { token, signal }));
  const [demo, setDemo] = useState(false);
  const [perCondition, setPerCondition] = useState("2");
  const [role, setRole] = useState("analyst");
  const [condition, setCondition] = useState<string>("kanban");
  const [confirm, setConfirm] = useState<null | "names" | "messages" | "demo" | "sandbox">(null);
  const { run, busy } = useAction();
  const q = demo ? "?include_demo=true" : "";

  const seed = () => run(async () => {
    await api("/api/admin/demo/history", { method: "POST", token, body: { per_condition: Number(perCondition) } });
    await reload();
  }, "Демо-история засеяна — загляните в «Исследование»");

  const sandbox = () => run(async () => {
    const r = await api<{ participant_token: string; facilitator_token: string; team_id: string }>("/api/admin/demo/sandbox", {
      method: "POST", token, body: { role_slug: role, condition },
    });
    store.set(TOKENS.participant, r.participant_token);
    store.set(TOKENS.director, r.facilitator_token);
    store.set(TOKENS.demoTeam, r.team_id);
    navigate("/play");
  });

  const purge = (what: "names" | "messages" | "demo" | "sandbox") => run(async () => {
    if (what === "names") await api("/api/admin/data/purge-names", { method: "POST", token });
    else if (what === "messages") await api("/api/admin/data/purge-messages", { method: "POST", token });
    else await api(`/api/admin/demo${what === "sandbox" ? "?kind=sandbox" : "?kind=history"}`, { method: "DELETE", token });
    await reload();
  }, "Готово");

  return (
    <main className="page wide stack xl">
      <PageHead eyebrow="Данные" title="Выгрузки, приватность и демо"
        lead="Данные исследования хранятся псевдонимизированно и только дописываются. Имена и тексты Эфира — отдельно, их можно стереть после сбора." />
      {!status ? <Loader /> : (
        <div className="stats">
          <Stat k="Команд" v={status.teams} />
          <Stat k="Событий процесса" v={status.events} />
          <Stat k="Имён в таблице соответствия" v={status.names} />
          <Stat k="Текстов Эфира" v={status.messages} />
          <Stat k="Демо: история / песочницы" v={null} raw={<>{status.demo_history}<small> / {status.demo_sandbox}</small></>} />
        </div>
      )}

      <section className="panel stack lg">
        <div className="row between wrap">
          <div className="panel-title"><FileArchive size={18} /><h3>Выгрузки</h3></div>
          <div className="row wrap">
            <label className="row tight small soft" style={{ cursor: "pointer" }}><Switch checked={demo} onChange={setDemo} label="С демо-данными" />с демо-данными</label>
            <button className="btn primary" disabled={busy} onClick={() => run(() => download(`/api/admin/export/all.zip${q}`, token, "tessera-all.zip"))}>
              <Download size={16} />Всё одним архивом
            </button>
          </div>
        </div>
        <div className="export-groups">
          {EXPORTS.map((g) => (
            <div key={g.group} className="stack sm">
              <span className="eyebrow">{g.group}</span>
              {g.items.map((x) => (
                <button key={x.name} className="export-row" disabled={busy} onClick={() => run(() => download(`/api/admin/export/${x.name}${q}`, token, `tessera-${x.name}`))}>
                  {x.name.endsWith(".csv") ? <FileSpreadsheet size={17} /> : <Workflow size={17} />}
                  <span className="stack xs grow" style={{ minWidth: 0 }}><strong className="small">{x.title}</strong><span className="tiny muted ellipsis">{x.text}</span></span>
                  <span className="mono tiny muted">{x.name}</span>
                  <Download size={15} className="muted" />
                </button>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="grid-2" style={{ alignItems: "start" }}>
        <section className="panel stack lg">
          <div className="panel-title"><Sparkles size={18} /><h3>Демо-данные</h3></div>
          <p className="small soft">Сгенерированная история прошлых сессий: по нескольку команд на каждую методику, с опросами, фактами, благодарностями и Синхроном. Помечена как демо и не попадает в анализ и выгрузки, пока вы этого не попросите.</p>
          <div className="row wrap">
            <span className="small soft">Команд на методику</span>
            <Segmented value={perCondition} onChange={setPerCondition} items={["1", "2", "3", "4"].map((v) => ({ key: v, title: v }))} />
            <button className="btn primary" disabled={busy} onClick={() => void seed()}><Sparkles size={15} />Засеять</button>
          </div>
          <hr className="divider" />
          <div className="stack sm">
            <strong>Песочница: пройти сессию одному</strong>
            <p className="small soft">Вы — один участник, остальные — боты. Внизу экрана — панель режиссёра: этапы, вбросы, эксперименты, скорость ботов и «смотреть глазами» любого.</p>
            <div className="grid-2">
              <div className="field"><label>Ваша роль</label>
                <Select label="Ваша роль" value={role} onChange={setRole} showHint options={SANDBOX_ROLES} /></div>
              <div className="field"><label>Методика</label>
                <Select label="Методика" value={condition} onChange={setCondition} showHint
                  options={CONDITIONS.map((c) => ({ value: c.key, label: c.title, hint: c.blurb, icon: <span className="dot-ico" style={{ background: condColor(c.key) }} /> }))} /></div>
            </div>
            <button className="btn accent" disabled={busy} onClick={() => void sandbox()}><Gamepad2 size={16} />Открыть песочницу</button>
          </div>
          <hr className="divider" />
          <div className="row wrap">
            <button className="btn danger sm" disabled={busy || !status?.demo_history} onClick={() => setConfirm("demo")}><Trash size={14} />Удалить демо-историю</button>
            <button className="btn danger sm" disabled={busy || !status?.demo_sandbox} onClick={() => setConfirm("sandbox")}><Trash size={14} />Удалить песочницы</button>
          </div>
        </section>

        <section className="panel stack lg">
          <div className="panel-title"><Eraser size={18} /><h3>Приватность</h3></div>
          <p className="small soft">После сбора данных сотрите то, что может указать на человека. Исследовательские таблицы (события, опросы, метаданные сообщений) останутся — они псевдонимизированы.</p>
          <div className="stack sm">
            <div className="int-row">
              <UserX size={18} />
              <div className="stack xs grow"><strong className="small">Стереть имена</strong><span className="tiny muted">Таблица соответствия «имя ↔ псевдоним». Команды увидят роли вместо имён.</span></div>
              <button className="btn danger sm" disabled={busy || !status?.names} onClick={() => setConfirm("names")}>Стереть</button>
            </div>
            <div className="int-row">
              <MessageSquareOff size={18} />
              <div className="stack xs grow"><strong className="small">Стереть тексты Эфира</strong><span className="tiny muted">Останется: кто, кому, когда и какой длины.</span></div>
              <button className="btn danger sm" disabled={busy || !status?.messages} onClick={() => setConfirm("messages")}>Стереть</button>
            </div>
          </div>
        </section>
      </div>

      <Confirm open={!!confirm} onClose={() => setConfirm(null)} danger confirm="Удалить навсегда"
        title={confirm === "names" ? "Стереть все имена?" : confirm === "messages" ? "Стереть тексты сообщений?" : confirm === "sandbox" ? "Удалить все песочницы?" : "Удалить демо-историю?"}
        text="Это действие нельзя отменить."
        onConfirm={() => confirm && void purge(confirm)} />
    </main>
  );
}
