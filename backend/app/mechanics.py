"""Механики командного взаимодействия: общий стол фактов, голосование, Эфир, помощь,
благодарности, погода, Синхрон, брифинг (личный выбор, проверка, прогноз, договор), ретро.

Каждая механика включается протоколом сессии. Всё, что делают участники, пишется в
research.* с псевдонимами — это данные исследования."""

from __future__ import annotations

from collections import Counter

from . import content
from .core import Ctx, commit_key_decision, fail, now, require_mechanic, require_present, silence_active, touch

WORK_PHASES = ("work",)
TALK_PHASES = ("lobby", "entry", "briefing", "work", "pulse", "debrief", "retro", "exit")


def _phase(ctx: Ctx, allowed: tuple[str, ...], message: str) -> None:
    if ctx.session["phase"] not in allowed:
        fail(409, message)


def team_members(conn, team_id: str) -> list[dict]:
    return conn.execute(
        """SELECT p.participant_id, d.role_slug, d.orig_role_slug, d.color_slot
             FROM research.participant p JOIN app.device d USING (participant_id)
            WHERE p.team_id = %s ORDER BY p.participant_id""",
        (team_id,),
    ).fetchall()


def own_role_slug(ctx: Ctx) -> str | None:
    """Факты принадлежат человеку, а не текущей роли: при смене ролей они остаются при нём."""
    return ctx.device.get("orig_role_slug") or ctx.role_slug


# ================================================================ общий стол

def share_fact(conn, ctx: Ctx, fact_id: str) -> None:
    require_mechanic(ctx, "facts")
    _phase(ctx, ("briefing", "work"), "Выкладывать факты можно на брифинге и во время работы")
    role = content.role(ctx.scenario, own_role_slug(ctx)) or {}
    if fact_id not in {f["id"] for f in role.get("facts", [])}:
        fail(403, "Это не ваш факт")
    conn.execute(
        """INSERT INTO research.fact_share (team_id, session_id, fact_id, participant_id)
           VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
        (ctx.team_id, ctx.session_id, fact_id, ctx.participant_id),
    )
    touch(conn, ctx.team_id)


def current_votes(conn, team_id: str, session_id: str) -> dict[str, str]:
    rows = conn.execute(
        """SELECT DISTINCT ON (participant_id) participant_id, option
             FROM research.vote_log WHERE team_id = %s AND session_id = %s
            ORDER BY participant_id, vote_id DESC""",
        (team_id, session_id),
    ).fetchall()
    return {r["participant_id"]: r["option"] for r in rows}


def final_decision(conn, ctx_or_session, scenario: dict) -> dict | None:
    team_id = ctx_or_session["team_id"] if isinstance(ctx_or_session, dict) else ctx_or_session.team_id
    session_id = ctx_or_session["session_id"] if isinstance(ctx_or_session, dict) else ctx_or_session.session_id
    return conn.execute(
        """SELECT chosen, proposed_by, rationale, decided_at FROM research.decision
            WHERE team_id = %s AND session_id = %s AND case_id = %s
            ORDER BY decided_at DESC LIMIT 1""",
        (team_id, session_id, f"{team_id}/{session_id}/DECISION-{scenario['decision']['key']}"),
    ).fetchone()


def vote(conn, ctx: Ctx, option: str) -> None:
    require_mechanic(ctx, "vote")
    _phase(ctx, WORK_PHASES, "Голосование идёт во время работы")
    if option not in {o["id"] for o in ctx.scenario["decision"]["options"]}:
        fail(422, "Такого варианта нет")
    if final_decision(conn, ctx, ctx.scenario):
        fail(409, "Решение уже зафиксировано")
    conn.execute(
        "INSERT INTO research.vote_log (participant_id, team_id, session_id, option) VALUES (%s, %s, %s, %s)",
        (ctx.participant_id, ctx.team_id, ctx.session_id, option),
    )
    touch(conn, ctx.team_id)


def finalize(conn, ctx: Ctx, rationale: str | None) -> str:
    """Фиксация решения: в иерархии решает руководитель, в остальных — большинство голосов."""
    require_mechanic(ctx, "vote")
    _phase(ctx, WORK_PHASES, "Решение фиксируется во время работы")
    if final_decision(conn, ctx, ctx.scenario):
        fail(409, "Решение уже зафиксировано")
    votes = current_votes(conn, ctx.team_id, ctx.session_id)
    members = team_members(conn, ctx.team_id)
    if ctx.hierarchy:
        if not ctx.is_pm:
            fail(403, "В иерархии решение фиксирует руководитель")
        chosen = votes.get(ctx.participant_id)
        if not chosen:
            fail(409, "Сначала проголосуйте сами — ваш голос и будет решением")
    else:
        if len(votes) * 2 < len(members):
            fail(409, f"Проголосовало {len(votes)} из {len(members)} — нужно хотя бы половина команды")
        ranked = Counter(votes.values()).most_common()
        if len(ranked) > 1 and ranked[0][1] == ranked[1][1]:
            fail(409, "Голоса разделились поровну — договоритесь и переголосуйте")
        chosen = ranked[0][0]
    # Автор решения — тот, кто первым проголосовал за победивший вариант.
    first = conn.execute(
        """SELECT participant_id FROM research.vote_log
            WHERE team_id = %s AND session_id = %s AND option = %s ORDER BY vote_id LIMIT 1""",
        (ctx.team_id, ctx.session_id, chosen),
    ).fetchone()
    commit_key_decision(conn, ctx, chosen, first["participant_id"] if first else ctx.participant_id, rationale, via="vote")
    return chosen


# ================================================================ брифинг

def set_preference(conn, ctx: Ctx, option: str, confidence: int) -> None:
    require_mechanic(ctx, "preference")
    _phase(ctx, ("briefing",), "Личный выбор делается на брифинге, до обсуждения")
    if option not in {o["id"] for o in ctx.scenario["decision"]["options"]}:
        fail(422, "Такого варианта нет")
    if not 1 <= confidence <= 5:
        fail(422, "Уверенность — от 1 до 5")
    conn.execute(
        """INSERT INTO research.preference (participant_id, team_id, session_id, stage, option, confidence)
           VALUES (%s, %s, %s, 'pre', %s, %s)
           ON CONFLICT (participant_id, team_id, session_id, stage)
           DO UPDATE SET option = EXCLUDED.option, confidence = EXCLUDED.confidence, answered_at = clock_timestamp()""",
        (ctx.participant_id, ctx.team_id, ctx.session_id, option, confidence),
    )
    touch(conn, ctx.team_id)


def check_spec(scenario: dict, condition: str) -> list[dict]:
    c = scenario.get("checks")
    if not c:
        return []
    second = c["second"][condition]
    return [
        {"id": "who_assigns", "question": c["question"], "options": c["options"], "correct": c["correct"][condition]},
        {"id": "rule", "question": second["question"], "options": second["options"], "correct": second["correct"]},
    ]


def _answers(conn, ctx: Ctx, phase: str, instrument: str) -> dict[str, dict]:
    rows = conn.execute(
        """SELECT item, value, text_value FROM research.survey_response
            WHERE participant_id = %s AND team_id = %s AND session_id = %s AND phase = %s AND instrument = %s""",
        (ctx.participant_id, ctx.team_id, ctx.session_id, phase, instrument),
    ).fetchall()
    return {r["item"]: r for r in rows}


def _put_answer(conn, ctx: Ctx, phase: str, instrument: str, item: str, value=None, text=None) -> None:
    conn.execute(
        """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item,
                                                 value, text_value)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (participant_id, team_id, session_id, phase, instrument, item)
           DO UPDATE SET value = EXCLUDED.value, text_value = EXCLUDED.text_value, answered_at = now()""",
        (ctx.participant_id, ctx.team_id, ctx.session_id, phase, instrument, item, value, text),
    )


def check_results(conn, ctx: Ctx) -> dict | None:
    spec = check_spec(ctx.scenario, ctx.condition)
    got = _answers(conn, ctx, "briefing", "check")
    if not spec or not got:
        return None
    return {q["id"]: {"answer": got[q["id"]]["text_value"], "correct": got[q["id"]]["text_value"] == q["correct"]}
            for q in spec if q["id"] in got}


def answer_check(conn, ctx: Ctx, answers: dict[str, str]) -> dict:
    require_mechanic(ctx, "check")
    _phase(ctx, ("briefing",), "Проверка понимания проходит на брифинге")
    spec = check_spec(ctx.scenario, ctx.condition)
    if _answers(conn, ctx, "briefing", "check"):
        return check_results(conn, ctx) or {}
    for q in spec:
        ans = answers.get(q["id"])
        if ans not in {o["id"] for o in q["options"]}:
            fail(422, "Ответьте на оба вопроса")
        _put_answer(conn, ctx, "briefing", "check", q["id"], text=ans)
    touch(conn, ctx.team_id)
    return check_results(conn, ctx) or {}


def forecast(conn, ctx: Ctx, tasks_done: int, m1_on_time: bool, confidence: int) -> None:
    require_mechanic(ctx, "forecast")
    _phase(ctx, ("briefing",), "Прогноз делается на брифинге")
    total = conn.execute("SELECT count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s",
                         (ctx.team_id, ctx.session_id)).fetchone()["n"]
    if not 0 <= tasks_done <= max(total, 1) + 2:
        fail(422, "Прогноз вне диапазона")
    if not 1 <= confidence <= 5:
        fail(422, "Уверенность — от 1 до 5")
    _put_answer(conn, ctx, "briefing", "forecast", "tasks_done", value=tasks_done)
    _put_answer(conn, ctx, "briefing", "forecast", "m1_on_time", value=1 if m1_on_time else 0)
    _put_answer(conn, ctx, "briefing", "forecast", "confidence", value=confidence)
    touch(conn, ctx.team_id)


def my_forecast(conn, ctx: Ctx) -> dict | None:
    got = _answers(conn, ctx, "briefing", "forecast")
    if not got:
        return None
    return {k: float(v["value"]) for k, v in got.items()}


def set_charter(conn, ctx: Ctx, field: str, body: str) -> None:
    require_mechanic(ctx, "charter")
    _phase(ctx, ("briefing", "work"), "Договор заполняется на брифинге и во время работы")
    if field not in {f["id"] for f in ctx.scenario.get("charter", [])}:
        fail(422, "Нет такого пункта договора")
    body = body.strip()[:400]
    if not body:
        conn.execute("DELETE FROM research.charter WHERE team_id = %s AND session_id = %s AND field = %s",
                     (ctx.team_id, ctx.session_id, field))
    else:
        conn.execute(
            """INSERT INTO research.charter (team_id, session_id, field, body, participant_id)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (team_id, session_id, field)
               DO UPDATE SET body = EXCLUDED.body, participant_id = EXCLUDED.participant_id,
                             updated_at = clock_timestamp()""",
            (ctx.team_id, ctx.session_id, field, body, ctx.participant_id),
        )
    touch(conn, ctx.team_id)


# ================================================================ Эфир

def post_message(conn, ctx: Ctx, body: str, mentions: list[str], case_key: str | None) -> int:
    require_mechanic(ctx, "chat")
    _phase(ctx, TALK_PHASES, "Эфир закрыт")
    body = body.strip()
    if not body:
        fail(422, "Пустое сообщение")
    if len(body) > 500:
        fail(422, "Сообщение длиннее 500 символов")
    team = {m["participant_id"] for m in team_members(conn, ctx.team_id)}
    mentions = sorted({m for m in mentions if m in team and m != ctx.participant_id})
    if case_key:
        case_key = case_key.strip().upper()[:8]
        exists = conn.execute("SELECT 1 FROM app.task WHERE team_id = %s AND session_id = %s AND key = %s",
                              (ctx.team_id, ctx.session_id, case_key)).fetchone()
        case_key = case_key if exists else None
    mid = conn.execute(
        """INSERT INTO research.message (team_id, session_id, participant_id, mentions, length, case_key, during_silence)
           VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING message_id""",
        (ctx.team_id, ctx.session_id, ctx.participant_id, mentions, len(body), case_key,
         silence_active(ctx.session)),
    ).fetchone()["message_id"]
    conn.execute("INSERT INTO app.message_body (message_id, body) VALUES (%s, %s)", (mid, body))
    touch(conn, ctx.team_id, "air")
    return mid


# ================================================================ помощь, благодарности, погода

def request_help(conn, ctx: Ctx, case_key: str | None, note: str | None) -> int:
    require_mechanic(ctx, "help")
    _phase(ctx, WORK_PHASES, "Просить помощи можно во время работы")
    open_req = conn.execute(
        """SELECT help_id FROM research.help_request
            WHERE team_id = %s AND session_id = %s AND participant_id = %s AND resolved_at IS NULL""",
        (ctx.team_id, ctx.session_id, ctx.participant_id),
    ).fetchone()
    if open_req:
        fail(409, "У вас уже есть открытая просьба о помощи")
    case_id = None
    if case_key:
        row = conn.execute("SELECT case_id FROM app.task WHERE team_id = %s AND session_id = %s AND key = %s",
                           (ctx.team_id, ctx.session_id, case_key.strip().upper())).fetchone()
        case_id = row["case_id"] if row else None
    hid = conn.execute(
        """INSERT INTO research.help_request (team_id, session_id, participant_id, case_id, note)
           VALUES (%s, %s, %s, %s, %s) RETURNING help_id""",
        (ctx.team_id, ctx.session_id, ctx.participant_id, case_id, (note or "").strip()[:200] or None),
    ).fetchone()["help_id"]
    touch(conn, ctx.team_id)
    return hid


def _help(conn, ctx: Ctx, help_id: int) -> dict:
    row = conn.execute(
        "SELECT * FROM research.help_request WHERE help_id = %s AND team_id = %s AND session_id = %s FOR UPDATE",
        (help_id, ctx.team_id, ctx.session_id),
    ).fetchone()
    if row is None:
        fail(404, "Просьба не найдена")
    return row


def answer_help(conn, ctx: Ctx, help_id: int) -> None:
    require_mechanic(ctx, "help")
    require_present(ctx)
    h = _help(conn, ctx, help_id)
    if h["participant_id"] == ctx.participant_id:
        fail(409, "Нельзя откликнуться на свою просьбу")
    if h["resolved_at"]:
        fail(409, "Просьба уже закрыта")
    if h["helper_id"]:
        fail(409, "Уже кто-то откликнулся")
    conn.execute("UPDATE research.help_request SET helper_id = %s, helped_at = clock_timestamp() WHERE help_id = %s",
                 (ctx.participant_id, help_id))
    touch(conn, ctx.team_id)


def resolve_help(conn, ctx: Ctx, help_id: int) -> None:
    require_mechanic(ctx, "help")
    h = _help(conn, ctx, help_id)
    if ctx.participant_id not in (h["participant_id"], h["helper_id"]):
        fail(403, "Закрыть просьбу может автор или тот, кто помогает")
    if h["resolved_at"]:
        return
    conn.execute("UPDATE research.help_request SET resolved_at = clock_timestamp() WHERE help_id = %s", (help_id,))
    touch(conn, ctx.team_id)


def send_kudos(conn, ctx: Ctx, to: str, kind: str, note: str | None) -> None:
    require_mechanic(ctx, "kudos")
    _phase(ctx, ("work", "pulse", "debrief", "retro", "exit"), "Благодарить можно с начала работы")
    if to == ctx.participant_id:
        fail(422, "Себя не благодарят :)")
    if to not in {m["participant_id"] for m in team_members(conn, ctx.team_id)}:
        fail(422, "Такого участника нет в команде")
    if kind not in {k["id"] for k in ctx.scenario.get("kudos", [])}:
        fail(422, "Неизвестный вид благодарности")
    recent = conn.execute(
        """SELECT 1 FROM research.kudos WHERE team_id = %s AND session_id = %s AND from_participant = %s
              AND to_participant = %s AND sent_at > clock_timestamp() - interval '45 seconds'""",
        (ctx.team_id, ctx.session_id, ctx.participant_id, to),
    ).fetchone()
    if recent:
        fail(429, "Вы только что благодарили этого коллегу — чуть позже")
    conn.execute(
        """INSERT INTO research.kudos (team_id, session_id, from_participant, to_participant, kind, note)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (ctx.team_id, ctx.session_id, ctx.participant_id, to, kind, (note or "").strip()[:140] or None),
    )
    touch(conn, ctx.team_id)


def set_weather(conn, ctx: Ctx, value: int) -> None:
    require_mechanic(ctx, "weather")
    _phase(ctx, TALK_PHASES, "Погоду можно отметить во время сессии")
    if not 1 <= value <= 4:
        fail(422, "Погода — от 1 до 4")
    last = conn.execute(
        """SELECT value FROM research.mood WHERE team_id = %s AND session_id = %s AND participant_id = %s
            ORDER BY mood_id DESC LIMIT 1""",
        (ctx.team_id, ctx.session_id, ctx.participant_id),
    ).fetchone()
    if last and last["value"] == value:
        return
    conn.execute("INSERT INTO research.mood (team_id, session_id, participant_id, value) VALUES (%s, %s, %s, %s)",
                 (ctx.team_id, ctx.session_id, ctx.participant_id, value))
    touch(conn, ctx.team_id)


def latest_weather(conn, team_id: str, session_id: str) -> dict[str, int]:
    rows = conn.execute(
        """SELECT DISTINCT ON (participant_id) participant_id, value FROM research.mood
            WHERE team_id = %s AND session_id = %s ORDER BY participant_id, mood_id DESC""",
        (team_id, session_id),
    ).fetchall()
    return {r["participant_id"]: r["value"] for r in rows}


# ================================================================ Синхрон

def open_probe(conn, team_id: str, session_id: str) -> dict | None:
    return conn.execute(
        """SELECT * FROM research.probe WHERE team_id = %s AND session_id = %s AND closes_at > clock_timestamp()
            ORDER BY probe_id DESC LIMIT 1""",
        (team_id, session_id),
    ).fetchone()


def answer_probe(conn, ctx: Ctx, probe_id: int, answer: str) -> None:
    require_mechanic(ctx, "probes")
    p = conn.execute(
        "SELECT * FROM research.probe WHERE probe_id = %s AND team_id = %s AND session_id = %s",
        (probe_id, ctx.team_id, ctx.session_id),
    ).fetchone()
    if p is None:
        fail(404, "Вопрос не найден")
    if p["closes_at"] <= now():
        fail(409, "Время на ответ вышло")
    if answer not in {o["id"] for o in p["options"]}:
        fail(422, "Такого ответа нет")
    conn.execute(
        """INSERT INTO research.probe_answer (probe_id, participant_id, answer) VALUES (%s, %s, %s)
           ON CONFLICT DO NOTHING""",
        (probe_id, ctx.participant_id, answer),
    )
    touch(conn, ctx.team_id)


def probe_summary(conn, probe: dict, team_size: int) -> dict:
    answers = conn.execute("SELECT participant_id, answer FROM research.probe_answer WHERE probe_id = %s",
                           (probe["probe_id"],)).fetchall()
    counts = Counter(a["answer"] for a in answers)
    top = counts.most_common(1)[0][1] if counts else 0
    return {
        "probe_id": probe["probe_id"], "kind": probe["kind"], "question": probe["question"],
        "options": probe["options"], "truth": probe["truth"], "fired_at": probe["fired_at"],
        "closes_at": probe["closes_at"], "answered": len(answers), "team_size": team_size,
        "counts": dict(counts),
        "alignment": (top / len(answers)) if answers else None,
        "accuracy": (counts.get(probe["truth"], 0) / len(answers)) if answers and probe["truth"] else None,
        "answers": {a["participant_id"]: a["answer"] for a in answers},
    }


# ================================================================ ретро

MAX_RETRO_VOTES = 3


def retro_add(conn, ctx: Ctx, lane: str, body: str) -> None:
    require_mechanic(ctx, "retro")
    _phase(ctx, ("retro",), "Ретро открыто на этапе ретроспективы")
    if lane not in ("start", "stop", "continue"):
        fail(422, "Нет такой колонки")
    body = body.strip()
    if not body:
        fail(422, "Пустая карточка")
    conn.execute(
        """INSERT INTO research.retro_card (team_id, session_id, participant_id, lane, body)
           VALUES (%s, %s, %s, %s, %s)""",
        (ctx.team_id, ctx.session_id, ctx.participant_id, lane, body[:200]),
    )
    touch(conn, ctx.team_id)


def retro_vote(conn, ctx: Ctx, card_id: int) -> None:
    require_mechanic(ctx, "retro")
    _phase(ctx, ("retro",), "Голосовать можно на этапе ретроспективы")
    card = conn.execute("SELECT 1 FROM research.retro_card WHERE card_id = %s AND team_id = %s AND session_id = %s",
                        (card_id, ctx.team_id, ctx.session_id)).fetchone()
    if card is None:
        fail(404, "Карточка не найдена")
    mine = conn.execute("DELETE FROM research.retro_vote WHERE card_id = %s AND participant_id = %s",
                        (card_id, ctx.participant_id)).rowcount
    if not mine:
        used = conn.execute(
            """SELECT count(*) AS n FROM research.retro_vote v JOIN research.retro_card c USING (card_id)
                WHERE v.participant_id = %s AND c.team_id = %s AND c.session_id = %s""",
            (ctx.participant_id, ctx.team_id, ctx.session_id),
        ).fetchone()["n"]
        if used >= MAX_RETRO_VOTES:
            fail(409, f"У каждого {MAX_RETRO_VOTES} голоса — снимите голос с другой карточки")
        conn.execute("INSERT INTO research.retro_vote (card_id, participant_id) VALUES (%s, %s)",
                     (card_id, ctx.participant_id))
    touch(conn, ctx.team_id)


def make_agreements(conn, team_id: str, session_id: str, limit: int = 3) -> None:
    """Самые поддержанные карточки ретро становятся договорённостями на следующую сессию."""
    if conn.execute("SELECT 1 FROM research.agreement WHERE team_id = %s AND session_id = %s",
                    (team_id, session_id)).fetchone():
        return
    top = conn.execute(
        """SELECT c.card_id, c.lane, c.body, count(v.participant_id) AS votes
             FROM research.retro_card c LEFT JOIN research.retro_vote v USING (card_id)
            WHERE c.team_id = %s AND c.session_id = %s AND c.lane IN ('start', 'stop')
            GROUP BY c.card_id HAVING count(v.participant_id) > 0
            ORDER BY votes DESC, c.card_id LIMIT %s""",
        (team_id, session_id, limit),
    ).fetchall()
    for c in top:
        prefix = "Начать: " if c["lane"] == "start" else "Перестать: "
        conn.execute(
            "INSERT INTO research.agreement (team_id, session_id, card_id, body) VALUES (%s, %s, %s, %s)",
            (team_id, session_id, c["card_id"], prefix + c["body"]),
        )


def previous_agreements(conn, team_id: str, session_id: str) -> list[dict]:
    n = int(session_id.split("-")[1])
    if n <= 1:
        return []
    return conn.execute(
        "SELECT agreement_id, body, session_id FROM research.agreement WHERE team_id = %s AND session_id = %s ORDER BY agreement_id",
        (team_id, f"S-{n - 1}"),
    ).fetchall()

