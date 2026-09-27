"""Боты демо-команд: живые напарники для режима «Попробовать одному».

Бот действует через те же функции, что и человек (core, mechanics), поэтому соблюдает
правила методик и оставляет в research.* такие же данные. У каждого бота свой характер:
скорость, готовность помогать, разговорчивость, придирчивость на контроле."""

from __future__ import annotations

import random
from datetime import timedelta

from fastapi import HTTPException

from tessera.model import STAGES

from . import content, insights, mechanics
from .core import (BACKLOG, Ctx, close_milestone, ctx_for, current_sprint, now, set_phase, task_action,
                   work_minute)
from .db import json
from .surveys import submit_survey

PHRASES = {
    "take": ["Беру {key}", "{key} на мне", "Займусь «{title}»", "Взял(а) {key}"],
    "done": ["{key} готова, передаю дальше", "Закончил(а) {key} → «{stage}»", "{key} ушла на «{stage}»"],
    "rework": ["{key} возвращаю — есть замечания", "{key} не проходит контроль, вернул(а) на доработку"],
    "help_ask": ["Застрял(а) с {key}, кто может помочь?", "Нужна помощь по {key}", "Не понимаю, что делать с {key} 🙈"],
    "help_answer": ["Иду помогать!", "Сейчас подключусь", "Давай разберёмся вместе"],
    "fact": ["Выложил(а) на стол факт — посмотрите", "Положил(а) на стол важное про платформы", "Кстати: {fact}"],
    "vote": ["Я за вариант {opt}", "Голосую за {opt}", "Мне кажется, {opt} — лучший выбор"],
    "silence": ["Пишу сюда, раз вслух нельзя", "Тишина — ок, координируемся тут", "Кто на контроле? Там очередь"],
    "inject": ["Ого, срочный заказ…", "Перестраиваемся!", "Кто возьмёт новую задачу?", "Ну вот, опять вводные поменялись"],
    "chatter": ["Как у всех дела?", "Кто свободен?", "Не забываем про веху M-1", "У нас затор на «{stage}», может помочь?",
                "Смотрю на доску — идём неплохо", "Кто последний видел смету?"],
    "kudos_note": ["Спасибо, выручил(а)!", "Круто разобрался(ась)", "Без тебя бы не успели", "Спасибо за факты!"],
    "retro": {
        "start": ["Раньше выкладывать факты на стол", "Сразу проговаривать, кто что берёт", "Просить помощи сразу, а не через 5 минут",
                  "Договариваться о приоритетах в начале"],
        "stop": ["Брать по три задачи одновременно", "Молчать, когда застрял", "Решать без фактов финансиста"],
        "continue": ["Благодарить друг друга", "Помогать контролёру", "Держать веху в фокусе"],
    },
    "charter": {"goal": "Сдать M-1 в срок и выбрать платформу по фактам",
                "decisions": "Сначала все факты на стол, потом голосуем",
                "signals": "Застрял дольше 3 минут — жму «Нужна помощь»",
                "motto": "Каждый — фрагмент!"},
}


def persona(rng: random.Random) -> dict:
    return {"speed": round(rng.uniform(0.75, 1.3), 2), "helpful": round(rng.uniform(0.2, 0.95), 2),
            "chatty": round(rng.uniform(0.15, 0.9), 2), "careful": round(rng.uniform(0.1, 0.5), 2),
            "sharer": round(rng.uniform(0.25, 0.95), 2)}


class Brain:
    def __init__(self, conn, ctx: Ctx, bot: dict, rng: random.Random):
        self.conn, self.ctx, self.bot, self.rng = conn, ctx, bot, rng
        self.p = bot["persona"]
        self.mem = dict(bot["memory"] or {})
        self.scale = float(ctx.session["time_scale"] or 1)
        # Скорость ботов из панели режиссёра ускоряет и «работу» над задачей, а не только частоту тактов.
        self.speed = max(0.25, float(ctx.session.get("bot_speed") or 1))
        self.mech = ctx.mech

    # ---------------------------------------------------------------- утилиты
    def chance(self, p: float) -> bool:
        return self.rng.random() < p

    def say(self, kind: str, **kw) -> None:
        if not self.mech["chat"]:
            return
        text = self.rng.choice(PHRASES[kind]).format(**kw)
        mechanics.post_message(self.conn, self.ctx, text, [], kw.get("key"))

    def tasks(self) -> list[dict]:
        return self.conn.execute(
            "SELECT * FROM app.task WHERE team_id = %s AND session_id = %s ORDER BY position",
            (self.ctx.team_id, self.ctx.session_id)).fetchall()

    def home(self) -> list[str]:
        role = self.ctx.role or {}
        return role.get("home_stages", []) or ["Исполнение"]

    # ---------------------------------------------------------------- фазы
    def act(self) -> bool:
        phase = self.ctx.session["phase"]
        if phase in ("entry", "pulse", "exit"):
            return self.survey() or (phase != "entry" and self.social(0.15))
        if phase == "briefing":
            return self.briefing()
        if phase == "work":
            return self.work()
        if phase == "retro":
            return self.retro()
        return False

    # ---------------------------------------------------------------- опросы
    def survey(self) -> bool:
        from .views import survey_status

        spec = survey_status(self.conn, self.ctx.session, self.ctx.participant_id)
        if not spec or spec["done"]:
            return False
        if self.chance(0.5):  # отвечают не мгновенно
            return False
        answers, texts, noms = {}, {}, {}
        base = 4.8 + (self.p["helpful"] - 0.5)
        for inst in spec["instruments"]:
            if inst["type"] == "text":
                texts[inst["id"]] = {i["id"]: self.rng.choice(PHRASES["retro"]["start"]) for i in inst["items"] if not i.get("optional")}
                continue
            answers[inst["id"]] = {}
            for item in inst["items"]:
                if inst["type"] == "slider":
                    v = min(inst["max"], max(inst["min"], 5 * round(self.rng.gauss(55, 15) / 5)))
                else:
                    mid = base if inst["max"] == 7 else base * 5 / 7
                    v = round(min(inst["max"], max(inst["min"], self.rng.gauss(mid, 0.9))))
                    if item.get("reverse"):
                        v = inst["min"] + inst["max"] - v
                answers[inst["id"]][item["id"]] = v
        members = [m["participant_id"] for m in mechanics.team_members(self.conn, self.ctx.team_id)
                   if m["participant_id"] != self.ctx.participant_id]
        if spec["nominations"] and members:
            for q in spec["nominations"]:
                noms[q] = self.rng.sample(members, k=min(len(members), self.rng.randint(1, 2)))
        mirror = {}
        if spec.get("mirror") and members:
            mirror = {"team_stress": 5 * round(self.rng.gauss(50, 15) / 5), "most_loaded": self.rng.choice(members)}
        strengths = {}
        if spec.get("strengths"):
            ids = [s["id"] for s in self.ctx.scenario.get("strengths", [])]
            strengths = {m: self.rng.choice(ids) for m in members}
        agreements = {str(a["agreement_id"]): self.rng.randint(2, 5) for a in spec.get("agreements", [])}
        submit_survey(self.conn, self.ctx, {"answers": answers, "texts": texts, "nominations": noms,
                                            "mirror": mirror, "strengths": strengths, "agreements": agreements})
        return True

    # ---------------------------------------------------------------- брифинг
    def briefing(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if self.chance(0.4):
            return False
        if self.mech["weather"] and not mechanics.latest_weather(conn, ctx.team_id, ctx.session_id).get(ctx.participant_id):
            mechanics.set_weather(conn, ctx, self.rng.choice([3, 4, 4]))
            return True
        if self.mech["preference"] and not conn.execute(
                "SELECT 1 FROM research.preference WHERE participant_id = %s AND team_id = %s AND session_id = %s",
                (ctx.participant_id, ctx.team_id, ctx.session_id)).fetchone():
            own = content.role(ctx.scenario, mechanics.own_role_slug(ctx)) or {}
            n_key = sum(1 for f in own.get("facts", []) if f.get("key"))
            p_c = min(0.7, 0.2 + 0.1 * n_key)
            option = "C" if self.chance(p_c) else ("A" if self.chance(0.75) else "B")
            mechanics.set_preference(conn, ctx, option, self.rng.randint(2, 5))
            return True
        if self.mech["check"] and mechanics.check_results(conn, ctx) is None:
            spec = mechanics.check_spec(ctx.scenario, ctx.condition)
            answers = {q["id"]: q["correct"] if self.chance(0.85) else self.rng.choice(q["options"])["id"] for q in spec}
            mechanics.answer_check(conn, ctx, answers)
            return True
        if self.mech["forecast"] and mechanics.my_forecast(conn, ctx) is None:
            mechanics.forecast(conn, ctx, self.rng.randint(5, 10), self.chance(0.6), self.rng.randint(2, 4))
            return True
        if self.mech["charter"] and self.chance(0.3):
            filled = {r["field"] for r in conn.execute(
                "SELECT field FROM research.charter WHERE team_id = %s AND session_id = %s", (ctx.team_id, ctx.session_id))}
            empty = [f["id"] for f in ctx.scenario.get("charter", []) if f["id"] not in filled]
            if empty:
                field = empty[0]
                mechanics.set_charter(conn, ctx, field, PHRASES["charter"].get(field, "Работаем вместе"))
                return True
        return False

    # ---------------------------------------------------------------- работа
    def work(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if self.mech["probes"]:
            p = mechanics.open_probe(conn, ctx.team_id, ctx.session_id)
            if p and not conn.execute("SELECT 1 FROM research.probe_answer WHERE probe_id = %s AND participant_id = %s",
                                      (p["probe_id"], ctx.participant_id)).fetchone():
                mechanics.answer_probe(conn, ctx, p["probe_id"], self.probe_answer(p))
                return True
        if ctx.away_until:
            return False
        self.react_to_notices()
        if self.finish_task():
            return True
        if self.close_ready():
            return True
        if self.help_flow():
            return True
        roll = self.rng.random()
        if roll < 0.62 and self.take_work():
            return True
        if self.hierarchy_manage():
            return True
        return self.social(0.55)

    def probe_answer(self, p: dict) -> str:
        options = [o["id"] for o in p["options"]]
        truth = p["truth"]
        if p["kind"] == "budget":
            shared = insights.shared_facts(self.conn, self.ctx.session)
            knows = "finance.1" in shared or mechanics.own_role_slug(self.ctx) == "finance"
            if knows and truth in options:
                return truth
            return self.rng.choice(["3", "7", "?", "?"])
        if truth in options and self.chance(0.55):
            return truth
        # Командам свойственно совпадать с большинством — берём самый частый ответ, если он есть.
        popular = self.conn.execute(
            "SELECT answer, count(*) AS n FROM research.probe_answer WHERE probe_id = %s GROUP BY 1 ORDER BY 2 DESC LIMIT 1",
            (p["probe_id"],)).fetchone()
        if popular and self.chance(0.6):
            return popular["answer"]
        return self.rng.choice(options)

    def react_to_notices(self) -> None:
        last = self.mem.get("notice", 0)
        rows = self.conn.execute(
            """SELECT notice_id, kind FROM app.notice WHERE team_id = %s AND session_id = %s AND notice_id > %s
                ORDER BY notice_id""",
            (self.ctx.team_id, self.ctx.session_id, last)).fetchall()
        if not rows:
            return
        self.mem["notice"] = rows[-1]["notice_id"]
        kinds = {r["kind"] for r in rows}
        if "inject" in kinds and self.chance(self.p["chatty"]):
            self.say("inject")
            if self.mech["weather"] and self.chance(0.4):
                mechanics.set_weather(self.conn, self.ctx, self.rng.choice([2, 3]))
        if "silence" in kinds and self.chance(0.7):
            self.say("silence")

    def finish_task(self) -> bool:
        busy, until = self.bot["busy_case"], self.bot["busy_until"]
        if not busy or not until or until > now():
            return False
        t = self.conn.execute("SELECT * FROM app.task WHERE case_id = %s", (busy,)).fetchone()
        self.clear_busy()
        if t is None or t["assignee"] != self.ctx.participant_id or not t["started"]:
            return False
        if t["stage"] == "Контроль" and self.chance(self.p["careful"] * 0.7):
            task_action(self.conn, self.ctx, t["key"], "return", {})
            if self.chance(0.5):
                self.say("rework", key=t["key"])
            return True
        task_action(self.conn, self.ctx, t["key"], "advance", {})
        nxt = STAGES[STAGES.index(t["stage"]) + 1]
        if self.chance(self.p["chatty"] * 0.5):
            self.say("done", key=t["key"], stage=nxt)
        return True

    def set_busy(self, task: dict) -> None:
        minutes = self.rng.uniform(1.2, 3.2) * self.scale / max(0.3, self.p["speed"]) / self.speed
        self.bot["busy_case"] = task["case_id"]
        self.bot["busy_until"] = now() + timedelta(minutes=minutes)

    def clear_busy(self) -> None:
        self.bot["busy_case"] = None
        self.bot["busy_until"] = None

    def help_flow(self) -> bool:
        if not self.mech["help"]:
            return False
        conn, ctx = self.conn, self.ctx
        # Моя просьба: если откликнулись — через пару тактов закрываю и благодарю.
        mine = conn.execute(
            """SELECT * FROM research.help_request WHERE team_id = %s AND session_id = %s AND participant_id = %s
                  AND resolved_at IS NULL ORDER BY help_id DESC LIMIT 1""",
            (ctx.team_id, ctx.session_id, ctx.participant_id)).fetchone()
        if mine and mine["helper_id"] and mine["helped_at"] < now() - timedelta(seconds=80 * self.scale):
            mechanics.resolve_help(conn, ctx, mine["help_id"])
            if self.mech["kudos"] and self.chance(0.8):
                try:
                    with conn.transaction():
                        mechanics.send_kudos(conn, ctx, mine["helper_id"], "help", self.rng.choice(PHRASES["kudos_note"]))
                except HTTPException:
                    pass
            return True
        # Чужая просьба без отклика — помогаю, если я отзывчивый.
        others = conn.execute(
            """SELECT * FROM research.help_request WHERE team_id = %s AND session_id = %s AND participant_id <> %s
                  AND helper_id IS NULL AND resolved_at IS NULL ORDER BY help_id LIMIT 1""",
            (ctx.team_id, ctx.session_id, ctx.participant_id)).fetchone()
        if others and self.chance(self.p["helpful"]):
            mechanics.answer_help(conn, ctx, others["help_id"])
            if self.chance(self.p["chatty"]):
                self.say("help_answer")
            return True
        # Своя задача долго ждёт или просто тяжело — прошу помощи (редко).
        if not mine and self.chance(0.035):
            my = [t for t in self.tasks() if t["assignee"] == ctx.participant_id and t["stage"] in STAGES[:-1]]
            if my:
                t = self.rng.choice(my)
                mechanics.request_help(conn, ctx, t["key"], None)
                self.say("help_ask", key=t["key"])
                return True
        return False

    def take_work(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if self.bot["busy_case"]:
            return False
        tasks = self.tasks()
        me = ctx.participant_id
        home = self.home()
        waiting = [t for t in tasks if t["stage"] in STAGES[:-1] and not t["started"]]
        if ctx.hierarchy and not ctx.is_pm:
            waiting = [t for t in waiting if t["assignee"] == me]
        mine_first = sorted(waiting, key=lambda t: (t["assignee"] != me, t["stage"] not in home,
                                                    {"urgent": 0, "high": 1}.get(t["priority"], 2), t["position"]))
        for t in mine_first:
            if t["stage"] not in home and t["assignee"] != me and not self.chance(self.p["helpful"] * 0.6):
                continue
            task_action(conn, ctx, t["key"], "start", {})
            self.set_busy(t)
            if self.chance(self.p["chatty"] * 0.6):
                self.say("take", key=t["key"], title=t["title"])
            return True
        # Бэклог: в спринтах сначала планируем, в иерархии тянет только руководитель.
        backlog = [t for t in tasks if t["stage"] == BACKLOG]
        backlog.sort(key=lambda t: ({"urgent": 0, "high": 1}.get(t["priority"], 2), t["position"]))
        if backlog and (not ctx.hierarchy or ctx.is_pm) and ("Анализ" in home or self.chance(0.35)):
            t = backlog[0]
            if ctx.condition == "sprints" and (t["sprint"] is None or t["sprint"] > current_sprint(ctx.session)):
                task_action(conn, ctx, t["key"], "sprint", {"add": True})
                return True
            task_action(conn, ctx, t["key"], "pull", {})
            return True
        return False

    def hierarchy_manage(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if not (ctx.hierarchy and ctx.is_pm):
            return False
        members = mechanics.team_members(conn, ctx.team_id)
        for t in self.tasks():
            if t["stage"] in STAGES[:-1] and not t["started"] and t["assignee"] is None:
                fit = [m for m in members if t["stage"] in (content.role(ctx.scenario, m["role_slug"]) or {}).get("home_stages", [])]
                target = self.rng.choice(fit or members)
                task_action(conn, ctx, t["key"], "assign", {"assignee": target["participant_id"]})
                return True
        return False

    def close_ready(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if ctx.hierarchy and not ctx.is_pm:
            return False
        ready = conn.execute(
            """SELECT m.key FROM app.milestone m JOIN app.task t USING (milestone_id)
                WHERE m.team_id = %s AND m.session_id = %s AND m.closed_at IS NULL
                GROUP BY m.milestone_id, m.key HAVING bool_and(t.stage = %s)""",
            (ctx.team_id, ctx.session_id, STAGES[-1])).fetchone()
        if ready and self.chance(0.6):
            close_milestone(conn, ctx, ready["key"])
            return True
        return False

    def social(self, p_any: float) -> bool:
        if not self.chance(p_any):
            return False
        ctx = self.ctx
        minute = work_minute(ctx.session) or 0
        options = []
        if self.mech["facts"] and ctx.session["phase"] == "work":
            options.append(("fact", self.p["sharer"] * (0.4 + min(1.0, minute / (20 * self.scale)))))
        if self.mech["vote"] and ctx.session["phase"] == "work" and minute > 4 * self.scale:
            options.append(("vote", 0.5))
            options.append(("finalize", 0.25 if minute > 12 * self.scale else 0.0))
        if self.mech["kudos"]:
            options.append(("kudos", 0.25))
        if self.mech["weather"]:
            options.append(("weather", 0.12))
        if self.mech["chat"]:
            options.append(("chat", self.p["chatty"] * 0.35))
        if not options:
            return False
        kind = self.rng.choices([o[0] for o in options], [max(0.001, o[1]) for o in options])[0]
        return getattr(self, f"do_{kind}")()

    def do_fact(self) -> bool:
        conn, ctx = self.conn, self.ctx
        own = content.role(ctx.scenario, mechanics.own_role_slug(ctx)) or {}
        shared = insights.shared_facts(conn, ctx.session)
        left = [f for f in own.get("facts", []) if f["id"] not in shared]
        if not left:
            return False
        f = self.rng.choice(left)
        mechanics.share_fact(conn, ctx, f["id"])
        if self.chance(self.p["chatty"] * 0.6):
            self.say("fact", fact=f["text"][:90])
        return True

    def do_vote(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if mechanics.final_decision(conn, ctx, ctx.scenario):
            return False
        keys = insights.key_facts_in_play(conn, ctx.session)
        shared = set(insights.shared_facts(conn, ctx.session)) & keys
        p_c = 0.15 + 0.85 * (len(shared) / len(keys) if keys else 0)
        option = "C" if self.chance(p_c) else ("A" if self.chance(0.7) else "B")
        current = mechanics.current_votes(conn, ctx.team_id, ctx.session_id).get(ctx.participant_id)
        if current == option:
            return False
        mechanics.vote(conn, ctx, option)
        if self.chance(self.p["chatty"] * 0.5):
            self.say("vote", opt=option)
        return True

    def do_finalize(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if ctx.hierarchy and not ctx.is_pm:
            return False
        keys = insights.key_facts_in_play(conn, ctx.session)
        shared = set(insights.shared_facts(conn, ctx.session)) & keys
        minute = work_minute(ctx.session) or 0
        if keys and len(shared) < len(keys) and minute < 26 * self.scale and self.chance(0.7):
            return False
        if ctx.hierarchy and not mechanics.current_votes(conn, ctx.team_id, ctx.session_id).get(ctx.participant_id):
            return self.do_vote()
        mechanics.finalize(conn, ctx, "Сложили факты на столе и проголосовали")
        return True

    def do_kudos(self) -> bool:
        conn, ctx = self.conn, self.ctx
        members = [m["participant_id"] for m in mechanics.team_members(conn, ctx.team_id) if m["participant_id"] != ctx.participant_id]
        if not members:
            return False
        kinds = [k["id"] for k in ctx.scenario.get("kudos", [])]
        mechanics.send_kudos(conn, ctx, self.rng.choice(members), self.rng.choice(kinds),
                             self.rng.choice(PHRASES["kudos_note"]) if self.chance(0.4) else None)
        return True

    def do_weather(self) -> bool:
        load = sum(1 for t in self.tasks() if t["assignee"] == self.ctx.participant_id and t["started"])
        base = 4 - min(2, load) + (1 if self.chance(0.3) else 0)
        mechanics.set_weather(self.conn, self.ctx, max(1, min(4, base - (1 if self.chance(0.15) else 0))))
        return True

    def do_chat(self) -> bool:
        from .interventions import live_bottleneck
        stage = live_bottleneck(self.conn, self.ctx.session)
        self.say("chatter", stage=stage if stage != "none" else "Контроль")
        return True

    # ---------------------------------------------------------------- ретро
    def retro(self) -> bool:
        conn, ctx = self.conn, self.ctx
        if not self.mech["retro"] or self.chance(0.4):
            return False
        mine = conn.execute(
            "SELECT count(*) AS n FROM research.retro_card WHERE team_id = %s AND session_id = %s AND participant_id = %s",
            (ctx.team_id, ctx.session_id, ctx.participant_id)).fetchone()["n"]
        if mine < 2:
            lane = self.rng.choice(["start", "stop", "continue"])
            taken = {r["body"].strip().lower() for r in conn.execute(
                "SELECT body FROM research.retro_card WHERE team_id = %s AND session_id = %s AND lane = %s",
                (ctx.team_id, ctx.session_id, lane))}
            fresh = [x for x in PHRASES["retro"][lane] if x.strip().lower() not in taken]
            if fresh:  # одинаковые карточки не дублируем — бот голосует за уже написанную
                mechanics.retro_add(conn, ctx, lane, self.rng.choice(fresh))
                return True
        voted = conn.execute(
            """SELECT count(*) AS n FROM research.retro_vote v JOIN research.retro_card c USING (card_id)
                WHERE v.participant_id = %s AND c.team_id = %s AND c.session_id = %s""",
            (ctx.participant_id, ctx.team_id, ctx.session_id)).fetchone()["n"]
        if voted < mechanics.MAX_RETRO_VOTES:
            cards = conn.execute(
                """SELECT c.card_id, count(v.participant_id) AS n,
                          coalesce(bool_or(v.participant_id = %s), false) AS mine
                     FROM research.retro_card c LEFT JOIN research.retro_vote v USING (card_id)
                    WHERE c.team_id = %s AND c.session_id = %s GROUP BY c.card_id""",
                (ctx.participant_id, ctx.team_id, ctx.session_id)).fetchall()
            free = [c for c in cards if not c["mine"]]
            if free:
                weights = [1 + c["n"] * 2 for c in free]
                pick = self.rng.choices(free, weights)[0]
                mechanics.retro_vote(conn, ctx, pick["card_id"])
                return True
        return False


# ================================================================ такт

def tick_session(conn, session: dict, rng: random.Random) -> int:
    """Один такт для одной демо-команды. Каждое действие — в своей точке сохранения."""
    bots = conn.execute(
        """SELECT b.* FROM app.bot b JOIN app.device d USING (participant_id)
            WHERE d.team_id = %s AND NOT b.paused AND b.next_action_at <= now()""",
        (session["team_id"],)).fetchall()
    speed = float(session.get("bot_speed") or 1)
    acted = 0
    for bot in bots:
        ctx = ctx_for(conn, bot["participant_id"])
        brain = Brain(conn, ctx, bot, rng)
        did = False
        try:
            with conn.transaction():
                did = brain.act()
        except HTTPException:
            did = False
        acted += int(did)
        base = rng.uniform(2.5, 7.0) if did else rng.uniform(1.2, 3.5)
        delay = base / max(0.2, speed * bot["persona"].get("speed", 1))
        conn.execute(
            """UPDATE app.bot SET next_action_at = now() + make_interval(secs => %s), busy_case = %s, busy_until = %s,
                                  memory = %s WHERE participant_id = %s""",
            (delay, brain.bot["busy_case"], brain.bot["busy_until"], json(brain.mem), bot["participant_id"]),
        )
    return acted


def autopilot(conn, session: dict) -> None:
    """В демо рабочая фаза заканчивается сама, когда выходит время: иначе боты работали бы бесконечно."""
    if session["phase"] == "work" and session["work_started_at"]:
        if (now() - session["work_started_at"]).total_seconds() / 60 >= session["work_minutes"]:
            set_phase(conn, session, "pulse")


def create_bots(conn, team_id: str, rng: random.Random, human: str | None = None) -> None:
    for m in mechanics.team_members(conn, team_id):
        conn.execute(
            """INSERT INTO app.bot (participant_id, persona, paused, next_action_at)
               VALUES (%s, %s, %s, now() + make_interval(secs => %s)) ON CONFLICT (participant_id) DO NOTHING""",
            (m["participant_id"], json(persona(rng)), m["participant_id"] == human, rng.uniform(1, 4)),
        )
