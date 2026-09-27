"""Приём опросов (вход, пульс, выход): шкалы, открытые ответы, оценки коллег, Зеркало,
сильные стороны и проверка договорённостей. Общий код для API и ботов."""

from __future__ import annotations

from . import mechanics
from .core import Ctx, fail, touch


def submit_survey(conn, ctx: Ctx, body: dict) -> None:
    from .views import survey_status

    status = survey_status(conn, ctx.session, ctx.participant_id)
    if status is None:
        fail(409, "Сейчас нет открытого опроса")
    if status["done"]:
        fail(409, "Вы уже ответили на этот опрос")
    phase = ctx.session["phase"]
    answers = body.get("answers") or {}
    texts = body.get("texts") or {}
    rows = []
    for inst in status["instruments"]:
        for item in inst["items"]:
            if inst["type"] == "text":
                text = ((texts.get(inst["id"]) or {}).get(item["id"]) or "").strip()
                if not text and not item.get("optional"):
                    fail(422, f"Ответьте на вопрос: {item['text']}")
                if text:
                    rows.append((inst["id"], item["id"], None, text[:4000]))
                continue
            value = (answers.get(inst["id"]) or {}).get(item["id"])
            if value is None:
                fail(422, f"Ответьте на все вопросы блока «{inst['title']}»")
            if not inst["min"] <= float(value) <= inst["max"]:
                fail(422, "Ответ вне шкалы")
            rows.append((inst["id"], item["id"], float(value), None))

    team = {m["participant_id"] for m in mechanics.team_members(conn, ctx.team_id)}
    mirror = body.get("mirror") or {}
    if status.get("mirror"):
        stress = mirror.get("team_stress")
        if stress is None or not 0 <= float(stress) <= 100:
            fail(422, "Угадайте уровень стресса команды")
        rows.append(("mirror", "team_stress", float(stress), None))
        loaded = mirror.get("most_loaded")
        if loaded:
            if loaded not in team:
                fail(422, "Такого участника нет в команде")
            rows.append(("mirror", "most_loaded", None, loaded))

    for instrument, item, value, text in rows:
        conn.execute(
            """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item,
                                                     value, text_value)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
            (ctx.participant_id, ctx.team_id, ctx.session_id, phase, instrument, item, value, text),
        )

    if status["nominations"]:
        for question, targets in (body.get("nominations") or {}).items():
            if question not in status["nominations"]:
                fail(422, "Неизвестный вопрос о коллегах")
            for to in set(targets or []):
                if to == ctx.participant_id or to not in team:
                    continue
                conn.execute(
                    """INSERT INTO research.peer_nomination (from_participant, to_participant, team_id, session_id, question)
                       VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                    (ctx.participant_id, to, ctx.team_id, ctx.session_id, question),
                )

    if status.get("strengths"):
        valid = {s["id"] for s in ctx.scenario.get("strengths", [])}
        for to, strength in (body.get("strengths") or {}).items():
            if to == ctx.participant_id or to not in team or strength not in valid:
                continue
            conn.execute(
                """INSERT INTO research.strength (from_participant, to_participant, team_id, session_id, strength)
                   VALUES (%s, %s, %s, %s, %s)
                   ON CONFLICT (from_participant, to_participant, team_id, session_id) DO UPDATE SET strength = EXCLUDED.strength""",
                (ctx.participant_id, to, ctx.team_id, ctx.session_id, strength),
            )

    agreements = {str(a["agreement_id"]) for a in status.get("agreements") or []}
    for aid, score in (body.get("agreements") or {}).items():
        if str(aid) not in agreements or not 1 <= int(score) <= 5:
            continue
        conn.execute(
            """INSERT INTO research.agreement_check (agreement_id, participant_id, session_id, score)
               VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING""",
            (int(aid), ctx.participant_id, ctx.session_id, int(score)),
        )

    # Признак «опрос пройден» — хотя бы одна строка в survey_response этой фазы.
    if not rows:
        conn.execute(
            """INSERT INTO research.survey_response (participant_id, team_id, session_id, phase, instrument, item, text_value)
               VALUES (%s, %s, %s, %s, 'marker', 'done', 'done')""",
            (ctx.participant_id, ctx.team_id, ctx.session_id, phase),
        )
    touch(conn, ctx.team_id)

