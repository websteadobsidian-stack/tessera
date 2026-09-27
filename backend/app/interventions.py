"""Вмешательства ведущего и протокола: вбросы, Синхрон, тишина, выезд, смена ролей, подсказки.

Все вмешательства фиксируются в research.* с меткой источника (ведущий, таймлайн протокола,
режиссёр демо, система) — чтобы потом смотреть реакцию процесса."""

from __future__ import annotations

import random
from datetime import timedelta

from fastapi import HTTPException

from tessera.model import STAGES

from . import content, mechanics
from .core import BACKLOG, fail, insert_task, now, touch, work_minute
from .db import json

PROBE_SECONDS = 45


def _name(conn, pid: str) -> str:
    row = conn.execute(
        """SELECT coalesce(m.person, p.role) AS name FROM research.participant p
             LEFT JOIN identity.participant_map m USING (participant_id) WHERE p.participant_id = %s""",
        (pid,),
    ).fetchone()
    return row["name"] if row else pid


def notice(conn, session: dict, title: str, body: str = "", *, kind: str, roles: list[str] | None = None,
           participant_id: str | None = None, inject_id: int | None = None, signal: str | None = None) -> None:
    conn.execute(
        """INSERT INTO app.notice (team_id, session_id, inject_id, roles, title, body, kind, participant_id, signal)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        (session["team_id"], session["session_id"], inject_id, roles, title, body, kind, participant_id, signal),
    )


def _log(conn, session: dict, kind: str, payload: dict, source: str, ends_at=None) -> None:
    conn.execute(
        """INSERT INTO research.intervention (team_id, session_id, kind, payload, source, ends_at)
           VALUES (%s, %s, %s, %s, %s, %s)""",
        (session["team_id"], session["session_id"], kind, json(payload), source, ends_at),
    )


# ---------------------------------------------------------------- вбросы сценария

def fire_inject(conn, session: dict, key: str, source: str = "facilitator") -> dict:
    sc = content.scenario(session["scenario_version"])
    inj = next((i for i in sc["injects"] if i["key"] == key), None)
    if inj is None:
        fail(404, "Вброс не найден в сценарии")
    team_id, session_id = session["team_id"], session["session_id"]
    inject_id = conn.execute(
        """INSERT INTO research.inject (team_id, session_id, kind, ts, payload)
           VALUES (%s, %s, %s, now(), %s) RETURNING inject_id""",
        (team_id, session_id, key, json({"title": inj["title"], "phase": session["phase"], "source": source})),
    ).fetchone()["inject_id"]
    for n in inj.get("notices", []):
        notice(conn, session, n["title"], n.get("body", ""), kind="inject", roles=n.get("roles"), inject_id=inject_id)
    pos = conn.execute("SELECT coalesce(max(position), 0) AS p FROM app.task WHERE team_id = %s AND session_id = %s",
                       (team_id, session_id)).fetchone()["p"]
    for i, t in enumerate(inj.get("add_tasks", []), start=1):
        insert_task(conn, team_id, session_id, t, pos + i, inject_id)
    touch(conn, team_id, "inject")
    return {"kind": "inject", "key": key, "title": inj["title"]}


# ---------------------------------------------------------------- Синхрон

def live_bottleneck(conn, session: dict) -> str:
    rows = conn.execute(
        """SELECT stage, count(*) AS n FROM app.task
            WHERE team_id = %s AND session_id = %s AND NOT started AND stage = ANY(%s)
            GROUP BY stage ORDER BY n DESC""",
        (session["team_id"], session["session_id"], list(STAGES[:-1])),
    ).fetchall()
    return rows[0]["stage"] if rows and rows[0]["n"] >= 2 else "none"


def _probe_options(conn, session: dict, sc: dict, spec: dict) -> list[dict]:
    opts = spec["options"]
    team_id, session_id = session["team_id"], session["session_id"]
    if opts == "open_tasks":
        rows = conn.execute(
            """SELECT key, title FROM app.task WHERE team_id = %s AND session_id = %s AND stage <> %s
                ORDER BY CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
                         CASE WHEN stage = %s THEN 1 ELSE 0 END, position LIMIT 6""",
            (team_id, session_id, STAGES[-1], BACKLOG),
        ).fetchall()
        return [{"id": r["key"], "title": f"{r['key']} · {r['title']}"} for r in rows]
    if opts == "roster":
        members = mechanics.team_members(conn, team_id)
        return [{"id": m["participant_id"], "title": _name(conn, m["participant_id"])} for m in members] + [
            {"id": "none", "title": "Никто конкретно"}]
    if opts == "stages":
        return [{"id": s, "title": s} for s in STAGES[:-1]] + [{"id": "none", "title": "Затора нет"}]
    if opts == "weather":
        return [{"id": str(w["value"]), "title": w["title"]} for w in sc.get("weather", [])]
    return list(opts)


def _probe_truth(conn, session: dict, spec: dict) -> str | None:
    truth = spec.get("truth")
    if truth == "live_bottleneck":
        return live_bottleneck(conn, session)
    if truth == "live_weather":
        w = mechanics.latest_weather(conn, session["team_id"], session["session_id"])
        return str(round(sum(w.values()) / len(w))) if w else None
    return truth


def fire_probe(conn, session: dict, key: str, source: str = "facilitator") -> dict:
    sc = content.scenario(session["scenario_version"])
    spec = next((p for p in sc.get("probes", []) if p["key"] == key), None)
    if spec is None:
        fail(404, "Нет такого вопроса Синхрона")
    if mechanics.open_probe(conn, session["team_id"], session["session_id"]):
        fail(409, "Предыдущий Синхрон ещё идёт")
    options = _probe_options(conn, session, sc, spec)
    if len(options) < 2:
        fail(409, "Для этого вопроса пока не из чего выбирать")
    conn.execute(
        """INSERT INTO research.probe (team_id, session_id, kind, question, options, truth, source, closes_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, clock_timestamp() + make_interval(secs => %s))""",
        (session["team_id"], session["session_id"], key, spec["question"], json(options),
         _probe_truth(conn, session, spec), source, PROBE_SECONDS),
    )
    touch(conn, session["team_id"], "probe")
    return {"kind": "probe", "key": key, "title": spec.get("title", key)}


# ---------------------------------------------------------------- тишина, выезд, смена ролей, подсказки

def fire_silence(conn, session: dict, minutes: float, source: str) -> dict:
    minutes = max(0.5, min(float(minutes), 30))
    until = now() + timedelta(minutes=minutes)
    conn.execute("UPDATE app.session_state SET silence_until = %s WHERE team_id = %s AND session_id = %s",
                 (until, session["team_id"], session["session_id"]))
    _log(conn, session, "silence", {"minutes": minutes}, source, until)
    notice(conn, session, "Тишина", f"Следующие {_fmt_min(minutes)} говорить вслух нельзя. Общайтесь только в Эфире.",
           kind="silence")
    touch(conn, session["team_id"], "silence")
    return {"kind": "silence", "minutes": minutes}


def _fmt_min(minutes: float) -> str:
    if minutes < 1:
        return f"{round(minutes * 60)} сек"
    return f"{minutes:g} мин".replace(".", ",")


def _pick_participant(conn, session: dict, target: str | None, rng: random.Random) -> str:
    members = [m["participant_id"] for m in mechanics.team_members(conn, session["team_id"])]
    if not members:
        fail(409, "В команде никого нет")
    present = [m for m in members if not _is_away(conn, m)]
    if target in members:
        return target
    if target and target not in ("busiest", "random"):
        by_role = [m["participant_id"] for m in mechanics.team_members(conn, session["team_id"])
                   if m["role_slug"] == target and m["participant_id"] in present]
        if by_role:
            return by_role[0]
    if target == "busiest":
        rows = conn.execute(
            """SELECT assignee, count(*) AS n FROM app.task
                WHERE team_id = %s AND session_id = %s AND assignee IS NOT NULL AND stage <> %s
                GROUP BY assignee ORDER BY n DESC""",
            (session["team_id"], session["session_id"], STAGES[-1]),
        ).fetchall()
        for r in rows:
            if r["assignee"] in present:
                return r["assignee"]
    return rng.choice(present or members)


def _is_away(conn, pid: str) -> bool:
    row = conn.execute("SELECT away_until FROM app.device WHERE participant_id = %s", (pid,)).fetchone()
    return bool(row and row["away_until"] and row["away_until"] > now())


def fire_blind_spot(conn, session: dict, target: str | None, minutes: float, source: str,
                    rng: random.Random | None = None) -> dict:
    minutes = max(0.5, min(float(minutes), 30))
    pid = _pick_participant(conn, session, target or "busiest", rng or random.Random())
    until = now() + timedelta(minutes=minutes)
    conn.execute("UPDATE app.device SET away_until = %s, away_note = %s WHERE participant_id = %s",
                 (until, "Выезд к клиенту", pid))
    name = _name(conn, pid)
    _log(conn, session, "blind_spot", {"participant_id": pid, "minutes": minutes}, source, until)
    notice(conn, session, f"{name} уехал(а) к клиенту",
           f"На {_fmt_min(minutes)} {name} вне доступа. Задачи ждут — кто подхватит?", kind="blind_spot")
    notice(conn, session, "Вы на выезде у клиента",
           "Пока вас нет, команда работает без вас. Когда вернётесь — спросите в Эфире, что изменилось.",
           kind="blind_spot_self", participant_id=pid)
    touch(conn, session["team_id"], "blind_spot")
    return {"kind": "blind_spot", "participant_id": pid, "minutes": minutes}


def fire_role_swap(conn, session: dict, a: str | None, b: str | None, minutes: float, source: str,
                   rng: random.Random | None = None) -> dict:
    rng = rng or random.Random()
    minutes = max(0.5, min(float(minutes), 30))
    members = [m for m in mechanics.team_members(conn, session["team_id"]) if not m["orig_role_slug"]]
    by_id = {m["participant_id"]: m for m in members}

    def resolve(x: str | None, exclude: set[str]) -> dict | None:
        if x in by_id and x not in exclude:
            return by_id[x]
        cands = [m for m in members if m["participant_id"] not in exclude and (x in (None, "", "auto") or m["role_slug"] == x)]
        return rng.choice(cands) if cands else None

    first = resolve(a, set())
    if first is None:
        fail(409, "Некого менять ролями")
    second = resolve(b, {first["participant_id"]})
    # Меняются только разные роли.
    if second is None or second["role_slug"] == first["role_slug"]:
        others = [m for m in members if m["role_slug"] != first["role_slug"]]
        if not others:
            fail(409, "Некого менять ролями")
        second = rng.choice(others)
    until = now() + timedelta(minutes=minutes)
    for me, other in ((first, second), (second, first)):
        conn.execute(
            """UPDATE app.device SET orig_role_slug = role_slug, role_slug = %s, swap_until = %s
                WHERE participant_id = %s""",
            (other["role_slug"], until, me["participant_id"]),
        )
    sc = content.scenario(session["scenario_version"])
    ra, rb = content.role(sc, first["role_slug"]), content.role(sc, second["role_slug"])
    na, nb = _name(conn, first["participant_id"]), _name(conn, second["participant_id"])
    _log(conn, session, "role_swap", {"a": first["participant_id"], "b": second["participant_id"],
                                      "a_role": first["role_slug"], "b_role": second["role_slug"],
                                      "minutes": minutes}, source, until)
    notice(conn, session, "Смена ролей",
           f"На {_fmt_min(minutes)} {na} становится «{rb['title']}», а {nb} — «{ra['title']}». Посмотрите на процесс с другой стороны.",
           kind="role_swap")
    for pid, role in ((first["participant_id"], rb), (second["participant_id"], ra)):
        notice(conn, session, f"Теперь вы — {role['title']}",
               f"{role['summary']} Ваши собственные факты остаются при вас.", kind="role_swap_self", participant_id=pid)
    touch(conn, session["team_id"], "role_swap")
    return {"kind": "role_swap", "a": first["participant_id"], "b": second["participant_id"], "minutes": minutes}


def restore_swaps(conn) -> set[str]:
    rows = conn.execute(
        """UPDATE app.device SET role_slug = orig_role_slug, orig_role_slug = NULL, swap_until = NULL
            WHERE swap_until IS NOT NULL AND swap_until <= now() RETURNING team_id, participant_id""",
    ).fetchall()
    teams = {r["team_id"] for r in rows}
    for t in teams:
        touch(conn, t, "role_swap")
    return teams


def fire_nudge(conn, session: dict, text: str, participant_id: str | None, source: str) -> dict:
    text = (text or "").strip()
    if not text:
        fail(422, "Пустая подсказка")
    _log(conn, session, "nudge", {"text": text[:300], "participant_id": participant_id}, source)
    notice(conn, session, "Подсказка ведущего" if source == "facilitator" else "Подсказка", text[:300],
           kind="nudge", participant_id=participant_id)
    touch(conn, session["team_id"], "nudge")
    return {"kind": "nudge"}


# ---------------------------------------------------------------- диспетчер

def fire(conn, session: dict, kind: str, payload: dict, source: str = "facilitator",
         rng: random.Random | None = None) -> dict:
    if session["phase"] == "closed":
        fail(409, "Сессия завершена")
    minutes = float(payload.get("minutes") or 4 * float(session["time_scale"]))
    if kind == "inject":
        return fire_inject(conn, session, payload.get("key", ""), source)
    if kind == "probe":
        if not content.mechanics(session.get("mechanics")).get("probes"):
            fail(403, "Синхрон выключен в протоколе этой сессии")
        return fire_probe(conn, session, payload.get("key", ""), source)
    if kind == "silence":
        return fire_silence(conn, session, minutes, source)
    if kind == "blind_spot":
        return fire_blind_spot(conn, session, payload.get("target"), minutes, source, rng)
    if kind == "role_swap":
        return fire_role_swap(conn, session, payload.get("a"), payload.get("b"), minutes, source, rng)
    if kind == "nudge":
        return fire_nudge(conn, session, payload.get("text", ""), payload.get("participant_id"), source)
    fail(422, "Неизвестный вид вмешательства")


def fire_due(conn) -> int:
    """Срабатывание таймлайна протокола. Вызывается фоновым циклом раз в секунду."""
    rows = conn.execute(
        """SELECT s.item_id, s.team_id, s.session_id, s.kind, s.payload
             FROM app.schedule s JOIN app.session_state st USING (team_id, session_id)
            WHERE s.fired_at IS NULL AND st.phase = 'work' AND st.work_started_at IS NOT NULL
              AND st.work_started_at + make_interval(secs => s.minute * 60) <= now()
            ORDER BY s.minute FOR UPDATE OF s SKIP LOCKED""",
    ).fetchall()
    from .core import session_row

    fired = 0
    for r in rows:
        session = session_row(conn, r["team_id"], r["session_id"])
        try:
            with conn.transaction():
                fire(conn, session, r["kind"], r["payload"], source="schedule")
                conn.execute("UPDATE app.schedule SET fired_at = now() WHERE item_id = %s", (r["item_id"],))
            fired += 1
        except HTTPException as e:
            if e.status_code == 409 and r["kind"] == "probe":
                # Предыдущий вопрос ещё открыт — сдвигаем на полминуты.
                conn.execute("UPDATE app.schedule SET minute = minute + 0.5 WHERE item_id = %s", (r["item_id"],))
            else:
                conn.execute(
                    "UPDATE app.schedule SET fired_at = now(), payload = payload || %s WHERE item_id = %s",
                    (json({"error": str(e.detail)}), r["item_id"]),
                )
    return fired


def schedule_view(conn, session: dict) -> list[dict]:
    rows = conn.execute(
        """SELECT item_id, minute, kind, payload, fired_at FROM app.schedule
            WHERE team_id = %s AND session_id = %s ORDER BY minute, item_id""",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    sc = content.scenario(session["scenario_version"])
    titles = {("inject", i["key"]): i["title"] for i in sc["injects"]}
    titles.update({("probe", p["key"]): f"Синхрон: {p.get('title', p['key'])}" for p in sc.get("probes", [])})
    kinds = {i["kind"]: i["title"] for i in content.INTERVENTIONS}
    minute = work_minute(session)
    out = []
    for r in rows:
        key = r["payload"].get("key")
        out.append({
            **r,
            "title": titles.get((r["kind"], key)) or kinds.get(r["kind"], r["kind"]),
            "skipped": bool(r["payload"].get("skipped")),
            "error": r["payload"].get("error"),
            "due_in": None if minute is None else r["minute"] - minute,
        })
    return out


def timeline(conn, session: dict) -> list[dict]:
    """Всё, что происходило с командой извне, в одном списке — для пульта и разбора."""
    team_id, session_id = session["team_id"], session["session_id"]
    sc = content.scenario(session["scenario_version"])
    inj_titles = {i["key"]: i["title"] for i in sc["injects"]}
    items = []
    for r in conn.execute("SELECT kind, ts, payload FROM research.inject WHERE team_id = %s AND session_id = %s",
                          (team_id, session_id)):
        items.append({"kind": "inject", "key": r["kind"], "title": inj_titles.get(r["kind"], r["kind"]),
                      "at": r["ts"], "source": r["payload"].get("source", "facilitator")})
    for r in conn.execute("SELECT kind, question, fired_at, source FROM research.probe WHERE team_id = %s AND session_id = %s",
                          (team_id, session_id)):
        items.append({"kind": "probe", "key": r["kind"], "title": f"Синхрон: {r['question']}", "at": r["fired_at"],
                      "source": r["source"]})
    kinds = {i["kind"]: i["title"] for i in content.INTERVENTIONS}
    for r in conn.execute(
            "SELECT kind, payload, source, started_at, ends_at FROM research.intervention WHERE team_id = %s AND session_id = %s",
            (team_id, session_id)):
        title = kinds.get(r["kind"], r["kind"])
        if r["kind"] == "blind_spot":
            title = f"Выезд: {_name(conn, r['payload']['participant_id'])}"
        elif r["kind"] == "role_swap":
            title = f"Смена ролей: {_name(conn, r['payload']['a'])} ⇄ {_name(conn, r['payload']['b'])}"
        elif r["kind"] in ("nudge", "auto_nudge"):
            title = r["payload"].get("text", title)
        items.append({"kind": r["kind"], "title": title, "at": r["started_at"], "ends_at": r["ends_at"],
                      "source": r["source"]})
    items.sort(key=lambda x: x["at"])
    started = session.get("work_started_at")
    for x in items:
        x["minute"] = (x["at"] - started).total_seconds() / 60 if started else None
    return items

