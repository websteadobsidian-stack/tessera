"""Сборка состояния для экранов участника, ведущего и проектора."""

from __future__ import annotations

from datetime import timedelta

from . import content, insights, interventions, mechanics
from .core import Ctx, current_sprint, now, silence_active, work_minute

DEBRIEF_PHASES = ("debrief", "retro", "exit", "closed")


# ---------------------------------------------------------------- люди

def roster(conn, session: dict) -> list[dict]:
    sc = content.scenario(session["scenario_version"])
    weather = mechanics.latest_weather(conn, session["team_id"], session["session_id"])
    rows = conn.execute(
        """SELECT p.participant_id, d.role_slug, d.orig_role_slug, d.color_slot, d.away_until, d.swap_until,
                  d.last_seen_at, d.is_bot, m.person AS display_name
             FROM research.participant p
             JOIN app.device d USING (participant_id)
             LEFT JOIN identity.participant_map m USING (participant_id)
            WHERE p.team_id = %s ORDER BY p.participant_id""",
        (session["team_id"],),
    ).fetchall()
    t = now()
    out = []
    for r in rows:
        role = content.role(sc, r["role_slug"]) or {}
        orig = content.role(sc, r["orig_role_slug"]) if r["orig_role_slug"] else None
        out.append({
            "participant_id": r["participant_id"],
            "display_name": r["display_name"],
            "role_slug": r["role_slug"],
            "role_title": role.get("title", r["role_slug"]),
            "orig_role_title": orig["title"] if orig else None,
            "home_stages": role.get("home_stages", []),
            "color_slot": r["color_slot"] or 1,
            "away_until": r["away_until"] if r["away_until"] and r["away_until"] > t else None,
            "swap_until": r["swap_until"],
            "online": bool(r["is_bot"]) or bool(r["last_seen_at"] and r["last_seen_at"] > t - timedelta(seconds=45)),
            "is_bot": r["is_bot"],
            "weather": weather.get(r["participant_id"]),
        })
    return out


def roles_availability(conn, team_id: str, scenario: dict) -> list[dict]:
    taken = {
        r["role_slug"]: r["n"]
        for r in conn.execute(
            """SELECT coalesce(orig_role_slug, role_slug) AS role_slug, count(*) AS n FROM app.device
                WHERE team_id = %s AND participant_id IS NOT NULL GROUP BY 1""",
            (team_id,),
        ).fetchall()
    }
    return [
        {"slug": r["slug"], "title": r["title"], "department": r["department"], "summary": r["summary"],
         "capacity": r["capacity"], "taken": taken.get(r["slug"], 0), "colors": r.get("colors", []),
         "home_stages": r.get("home_stages", [])}
        for r in scenario["roles"]
    ]


# ---------------------------------------------------------------- сессия и сценарий

def session_public(session: dict) -> dict:
    return {
        "team_id": session["team_id"],
        "session_id": session["session_id"],
        "phase": session["phase"],
        "phase_changed_at": session["phase_changed_at"],
        "work_started_at": session["work_started_at"],
        "work_minutes": session["work_minutes"],
        "wip_limit": session["wip_limit"],
        "sprint_minutes": session["sprint_minutes"],
        "current_sprint": current_sprint(session),
        "time_scale": float(session["time_scale"]),
        "silence_until": session["silence_until"] if silence_active(session) else None,
        "work_minute": work_minute(session),
        "now": now(),
    }


def scenario_public(sc: dict, ctx: Ctx | None, condition: str, reveal: bool) -> dict:
    decision = {k: v for k, v in sc["decision"].items() if reveal or k not in ("correct", "explanation")}
    out = {
        "version": sc["version"],
        "title": sc["title"],
        "description": sc["description"],
        "legend": sc["legend"],
        "shared_facts": sc["shared_facts"],
        "decision": decision,
        "condition": {"key": condition, **sc["conditions"][condition]},
        "charter": sc.get("charter", []),
        "kudos": sc.get("kudos", []),
        "strengths": sc.get("strengths", []),
        "weather": sc.get("weather", []),
        "achievements": sc.get("achievements", []),
        "stages_by_role": {r["slug"]: r.get("home_stages", []) for r in sc["roles"]},
    }
    if ctx is not None:
        role = ctx.role
        own = content.role(sc, mechanics.own_role_slug(ctx))
        out["my_role"] = {k: role[k] for k in ("slug", "title", "department", "summary", "home_stages")} if role else None
        out["own_role"] = {k: own[k] for k in ("slug", "title", "department", "summary")} if own else None
    return out


# ---------------------------------------------------------------- доска и стол

def board(conn, session: dict, ctx: Ctx | None = None) -> dict:
    team_id, session_id = session["team_id"], session["session_id"]
    tasks = conn.execute(
        """SELECT t.key, t.title, t.description, t.project, t.priority, t.stage, t.assignee, t.started,
                  t.sprint, t.inject_id IS NOT NULL AS injected, m.key AS milestone, t.updated_at
             FROM app.task t LEFT JOIN app.milestone m USING (milestone_id)
            WHERE t.team_id = %s AND t.session_id = %s ORDER BY t.position""",
        (team_id, session_id),
    ).fetchall()
    milestones = conn.execute(
        """SELECT m.key, m.title, m.deadline, m.closed_at,
                  count(t.*) AS tasks, count(t.*) FILTER (WHERE t.stage = 'Сдача') AS done
             FROM app.milestone m LEFT JOIN app.task t USING (milestone_id)
            WHERE m.team_id = %s AND m.session_id = %s
            GROUP BY m.milestone_id ORDER BY m.key""",
        (team_id, session_id),
    ).fetchall()
    if ctx is None:
        notices = conn.execute(
            """SELECT notice_id, roles, title, body, kind, participant_id, created_at FROM app.notice
                WHERE team_id = %s AND session_id = %s ORDER BY notice_id DESC LIMIT 60""",
            (team_id, session_id),
        ).fetchall()
    else:
        notices = conn.execute(
            """SELECT notice_id, roles, title, body, kind, participant_id, created_at FROM app.notice
                WHERE team_id = %s AND session_id = %s
                  AND (roles IS NULL OR %s = ANY(roles) OR %s = ANY(roles))
                  AND (participant_id IS NULL OR participant_id = %s)
                ORDER BY notice_id DESC LIMIT 60""",
            (team_id, session_id, ctx.role_slug, mechanics.own_role_slug(ctx), ctx.participant_id),
        ).fetchall()
    decisions = conn.execute(
        """SELECT decision_id, case_id, title, proposed_by, alternatives, chosen, rationale, decided_at
             FROM research.decision WHERE team_id = %s AND session_id = %s ORDER BY decided_at DESC""",
        (team_id, session_id),
    ).fetchall()
    prefix = f"{team_id}/{session_id}/"
    for d in decisions:
        d["key_decision"] = bool(d["case_id"] and "/DECISION-" in d["case_id"])
        d["case_id"] = d["case_id"][len(prefix):] if d["case_id"] and d["case_id"].startswith(prefix) else d["case_id"]
    return {"tasks": tasks, "milestones": milestones, "notices": notices, "decisions": decisions}


def table(conn, session: dict, ctx: Ctx | None) -> dict:
    """Общий стол: выложенные факты, мои факты, голоса, итоговое решение."""
    sc = content.scenario(session["scenario_version"])
    mech = content.mechanics(session.get("mechanics"))
    facts = content.all_facts(sc)
    shared = insights.shared_facts(conn, session)
    admin = ctx is None
    reveal = admin or session["phase"] in DEBRIEF_PHASES
    out: dict = {
        "shared": [
            {"fact_id": fid, "text": facts[fid]["text"], "role": facts[fid]["role"], "role_title": facts[fid]["role_title"],
             "owner": r["participant_id"],
             "shared_at": r["shared_at"], **({"key": bool(facts[fid].get("key"))} if reveal else {})}
            for fid, r in sorted(shared.items(), key=lambda kv: kv[1]["shared_at"]) if fid in facts
        ],
        "key_total": len(insights.key_facts_in_play(conn, session)) if reveal else None,
    }
    if admin:
        out["all_facts"] = [{"fact_id": fid, **f, "shared": fid in shared} for fid, f in facts.items()
                            if f["role"] in insights.present_roles(conn, session["team_id"])]
    else:
        own = content.role(sc, mechanics.own_role_slug(ctx)) or {}
        out["my_facts"] = [{"fact_id": f["id"], "text": f["text"], "shared": f["id"] in shared}
                           for f in own.get("facts", [])]
    votes = mechanics.current_votes(conn, session["team_id"], session["session_id"])
    final = mechanics.final_decision(conn, session, sc)
    visible = admin or mech["votes_visible"] or final is not None
    counts: dict[str, int] = {}
    for opt in votes.values():
        counts[opt] = counts.get(opt, 0) + 1
    out["votes"] = {
        "mine": votes.get(ctx.participant_id) if ctx else None,
        "voters": sorted(votes),
        "counts": counts if visible else None,
        "by": votes if visible else None,
    }
    out["final"] = None
    if final:
        out["final"] = {**final, **({"correct": sc["decision"]["correct"], "explanation": sc["decision"]["explanation"],
                                     "is_correct": final["chosen"] == sc["decision"]["correct"]} if reveal else {})}
    if ctx is not None:
        pre = conn.execute(
            """SELECT option, confidence FROM research.preference
                WHERE participant_id = %s AND team_id = %s AND session_id = %s AND stage = 'pre'""",
            (ctx.participant_id, ctx.team_id, ctx.session_id),
        ).fetchone()
        out["my_pre"] = pre
    return out


def air(conn, session: dict, limit: int = 150) -> list[dict]:
    rows = conn.execute(
        """SELECT m.message_id, m.participant_id, m.mentions, m.case_key, m.during_silence, m.sent_at, b.body
             FROM research.message m LEFT JOIN app.message_body b USING (message_id)
            WHERE m.team_id = %s AND m.session_id = %s ORDER BY m.message_id DESC LIMIT %s""",
        (session["team_id"], session["session_id"], limit),
    ).fetchall()
    return list(reversed(rows))


def help_list(conn, session: dict) -> list[dict]:
    rows = conn.execute(
        """SELECT h.help_id, h.participant_id, h.note, h.created_at, h.helper_id, h.helped_at, h.resolved_at,
                  t.key AS case_key, t.title AS case_title
             FROM research.help_request h LEFT JOIN app.task t ON t.case_id = h.case_id
            WHERE h.team_id = %s AND h.session_id = %s
              AND (h.resolved_at IS NULL OR h.resolved_at > now() - interval '10 minutes')
            ORDER BY h.help_id DESC LIMIT 30""",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    return rows


def kudos_list(conn, session: dict, limit: int = 80) -> list[dict]:
    return conn.execute(
        """SELECT kudos_id, from_participant, to_participant, kind, note, sent_at FROM research.kudos
            WHERE team_id = %s AND session_id = %s ORDER BY kudos_id DESC LIMIT %s""",
        (session["team_id"], session["session_id"], limit),
    ).fetchall()


def probe_state(conn, session: dict, ctx: Ctx | None) -> dict:
    size = len(mechanics.team_members(conn, session["team_id"]))
    out: dict = {"open": None, "last": None}
    p = mechanics.open_probe(conn, session["team_id"], session["session_id"])
    if p:
        s = mechanics.probe_summary(conn, p, size)
        out["open"] = {k: s[k] for k in ("probe_id", "kind", "question", "options", "closes_at", "answered", "team_size")}
        if ctx is not None:
            out["open"]["my_answer"] = s["answers"].get(ctx.participant_id)
        else:
            out["open"]["answers"] = s["answers"]
    last = conn.execute(
        """SELECT * FROM research.probe WHERE team_id = %s AND session_id = %s AND closes_at <= clock_timestamp()
            ORDER BY probe_id DESC LIMIT 1""",
        (session["team_id"], session["session_id"]),
    ).fetchone()
    if last and (ctx is None or last["closes_at"] > now() - timedelta(seconds=40)):
        s = mechanics.probe_summary(conn, last, size)
        out["last"] = {k: s[k] for k in ("probe_id", "kind", "question", "options", "counts", "alignment",
                                         "accuracy", "truth", "answered", "team_size", "closes_at")}
        if ctx is not None:
            out["last"]["my_answer"] = s["answers"].get(ctx.participant_id)
    return out


def weather_state(conn, session: dict, ctx: Ctx | None) -> dict:
    w = mechanics.latest_weather(conn, session["team_id"], session["session_id"])
    vals = list(w.values())
    return {
        "mine": w.get(ctx.participant_id) if ctx else None,
        "average": (sum(vals) / len(vals)) if vals else None,
        "counts": {str(v): vals.count(v) for v in (1, 2, 3, 4)},
    }


def charter_state(conn, session: dict) -> dict:
    rows = conn.execute(
        "SELECT field, body, participant_id, updated_at FROM research.charter WHERE team_id = %s AND session_id = %s",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    return {r["field"]: r for r in rows}


def briefing_state(conn, session: dict, ctx: Ctx) -> dict:
    sc = ctx.scenario
    return {
        "check": [{k: v for k, v in q.items() if k != "correct"} for q in mechanics.check_spec(sc, ctx.condition)],
        "check_results": mechanics.check_results(conn, ctx),
        "forecast": mechanics.my_forecast(conn, ctx),
        "tasks_total": conn.execute("SELECT count(*) AS n FROM app.task WHERE team_id = %s AND session_id = %s",
                                    (ctx.team_id, ctx.session_id)).fetchone()["n"],
        "agreements_prev": mechanics.previous_agreements(conn, ctx.team_id, ctx.session_id),
    }


def survey_status(conn, session: dict, participant_id: str | None) -> dict | None:
    phase = session["phase"]
    spec = content.phase_spec(phase)
    if spec is None or participant_id is None:
        return None
    mech = content.mechanics(session.get("mechanics"))
    done = conn.execute(
        """SELECT 1 FROM research.survey_response
            WHERE participant_id = %s AND team_id = %s AND session_id = %s AND phase = %s LIMIT 1""",
        (participant_id, session["team_id"], session["session_id"], phase),
    ).fetchone() is not None
    if not mech["mirror"]:
        spec["mirror"] = None
    spec["strengths"] = spec["strengths"] and mech["strengths"]
    spec["agreements"] = (mechanics.previous_agreements(conn, session["team_id"], session["session_id"])
                          if spec["agreements"] and mech["retro"] else [])
    if spec["instruments"] and not mech["vote"] and not mech["facts"]:
        spec["instruments"] = [i for i in spec["instruments"] if i["id"] != "decision_confidence"]
    return {"done": done, **spec}


def retro_state(conn, session: dict, ctx: Ctx | None) -> dict:
    cards = conn.execute(
        """SELECT c.card_id, c.lane, c.body, c.participant_id, c.created_at, count(v.participant_id) AS votes,
                  coalesce(bool_or(v.participant_id = %s), false) AS voted
             FROM research.retro_card c LEFT JOIN research.retro_vote v USING (card_id)
            WHERE c.team_id = %s AND c.session_id = %s
            GROUP BY c.card_id ORDER BY votes DESC, c.card_id""",
        (ctx.participant_id if ctx else "", session["team_id"], session["session_id"]),
    ).fetchall()
    used = sum(1 for c in cards if c["voted"])
    for c in cards:
        c["mine"] = bool(ctx and c["participant_id"] == ctx.participant_id)
        if ctx is not None:
            c.pop("participant_id")  # карточки ретро анонимны для команды
    agreements = conn.execute(
        "SELECT agreement_id, body, card_id FROM research.agreement WHERE team_id = %s AND session_id = %s ORDER BY agreement_id",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    return {"cards": cards, "votes_left": mechanics.MAX_RETRO_VOTES - used, "agreements": agreements}


def achievements_state(conn, session: dict) -> list[dict]:
    sc = content.scenario(session["scenario_version"])
    defs = {a["key"]: a for a in sc.get("achievements", [])}
    rows = conn.execute(
        "SELECT key, unlocked_at FROM research.achievement WHERE team_id = %s AND session_id = %s ORDER BY unlocked_at",
        (session["team_id"], session["session_id"]),
    ).fetchall()
    return [{**defs.get(r["key"], {"key": r["key"], "title": r["key"], "text": ""}), "unlocked_at": r["unlocked_at"]}
            for r in rows]


def team_progress(conn, session: dict) -> dict:
    """Кто что уже сделал на брифинге и в опросах — чтобы видеть, кого ждём."""
    t, s = session["team_id"], session["session_id"]
    done: dict[str, list[str]] = {}
    for r in conn.execute(
            """SELECT DISTINCT participant_id, phase || ':' || instrument AS what FROM research.survey_response
                WHERE team_id = %s AND session_id = %s""", (t, s)):
        done.setdefault(r["participant_id"], []).append(r["what"])
    for r in conn.execute("SELECT participant_id FROM research.preference WHERE team_id = %s AND session_id = %s AND stage = 'pre'",
                          (t, s)):
        done.setdefault(r["participant_id"], []).append("briefing:preference")
    return done


# ---------------------------------------------------------------- полные состояния

def participant_state(conn, ctx: Ctx) -> dict:
    session = ctx.session
    sc = ctx.scenario
    mech = ctx.mech
    phase = session["phase"]
    reveal = phase in DEBRIEF_PHASES
    me = next((r for r in roster(conn, session) if r["participant_id"] == ctx.participant_id), None)
    state = {
        "me": {**(me or {}), "is_pm": ctx.is_pm},
        "mechanics": mech,
        "scenario": scenario_public(sc, ctx, ctx.condition, reveal),
        "roster": roster(conn, session),
        "survey": survey_status(conn, session, ctx.participant_id),
        "table": table(conn, session, ctx) if (mech["facts"] or mech["vote"] or mech["preference"]) else None,
        "air": air(conn, session) if mech["chat"] else [],
        "help": help_list(conn, session) if mech["help"] else [],
        "kudos": kudos_list(conn, session) if mech["kudos"] else [],
        "weather": weather_state(conn, session, ctx) if mech["weather"] else None,
        "probe": probe_state(conn, session, ctx) if mech["probes"] else None,
        "charter": charter_state(conn, session) if mech["charter"] else {},
        "briefing": briefing_state(conn, session, ctx) if phase in ("lobby", "entry", "briefing", "work") else None,
        "retro": retro_state(conn, session, ctx) if mech["retro"] and phase in ("retro", "exit", "closed") else None,
        "synergy": insights.synergy(conn, session) if mech["synergy"] or reveal else None,
        "achievements": achievements_state(conn, session) if mech["achievements"] or reveal else [],
        "progress": team_progress(conn, session) if phase in ("entry", "briefing", "pulse", "exit") else {},
        **board(conn, session, ctx),
    }
    return state


def admin_live(conn, session: dict) -> dict:
    t, s = session["team_id"], session["session_id"]
    sc = content.scenario(session["scenario_version"])
    feed = conn.execute(
        """SELECT e.event_id, e.ts, e.activity, e.case_id, e.resource, e.attrs
             FROM research.event e WHERE e.team_id = %s AND e.session_id = %s
            ORDER BY e.event_id DESC LIMIT 60""",
        (t, s),
    ).fetchall()
    prefix = f"{t}/{s}/"
    for f in feed:
        f["case_id"] = f["case_id"].removeprefix(prefix)
    counts = conn.execute("SELECT count(*) AS n FROM research.event WHERE team_id = %s AND session_id = %s",
                          (t, s)).fetchone()["n"]
    pending = conn.execute("SELECT count(*) AS n FROM app.device WHERE team_id = %s AND participant_id IS NULL",
                           (t,)).fetchone()["n"]
    notes = conn.execute("SELECT notes FROM research.session WHERE team_id = %s AND session_id = %s", (t, s)).fetchone()
    return {
        "team": {"team_id": t, "join_code": session["join_code"], "label": session["label"],
                 "condition": session["condition"], "condition_title": sc["conditions"][session["condition"]]["title"],
                 "scenario_version": session["scenario_version"], "is_demo": session["is_demo"],
                 "demo_kind": session["demo_kind"], "bot_speed": float(session["bot_speed"]),
                 "protocol": {"protocol_id": session["protocol"].get("protocol_id"),
                              "title": session["protocol"].get("title")}},
        "session": session_public(session),
        "mechanics": content.mechanics(session.get("mechanics")),
        "scenario": scenario_public(sc, None, session["condition"], True),
        "injects": [{"key": i["key"], "title": i["title"], "hint": i.get("hint", ""), "icon": i.get("icon", "zap")}
                    for i in sc["injects"]],
        "probes": [{"key": p["key"], "title": p.get("title", p["key"]), "question": p["question"]}
                   for p in sc.get("probes", [])],
        "roster": roster(conn, session),
        "progress": team_progress(conn, session),
        "pending_devices": pending,
        "table": table(conn, session, None),
        "air": air(conn, session),
        "help": help_list(conn, session),
        "kudos": kudos_list(conn, session),
        "weather": weather_state(conn, session, None),
        "probe": probe_state(conn, session, None),
        "charter": charter_state(conn, session),
        "retro": retro_state(conn, session, None),
        "synergy": insights.synergy(conn, session),
        "achievements": achievements_state(conn, session),
        "signals": insights.signals(conn, session),
        "schedule": interventions.schedule_view(conn, session),
        "timeline": interventions.timeline(conn, session),
        "feed": feed,
        "events": counts,
        "notes": (notes or {}).get("notes") or "",
        **board(conn, session, None),
    }


def stage_state(conn, session: dict) -> dict:
    from .analytics import mosaic_tiles

    sc = content.scenario(session["scenario_version"])
    last_notice = conn.execute(
        """SELECT notice_id, title, body, kind, created_at FROM app.notice
            WHERE team_id = %s AND session_id = %s AND participant_id IS NULL AND roles IS NULL
            ORDER BY notice_id DESC LIMIT 1""",
        (session["team_id"], session["session_id"]),
    ).fetchone()
    b = board(conn, session, None)
    return {
        "team": {"team_id": session["team_id"], "join_code": session["join_code"], "label": session["label"],
                 "condition": session["condition"], "condition_title": sc["conditions"][session["condition"]]["title"],
                 "is_demo": session["is_demo"]},
        "company": {"title": sc["title"]},
        "session": session_public(session),
        "roster": roster(conn, session),
        "tiles": mosaic_tiles(conn, session),
        "synergy": insights.synergy(conn, session),
        "achievements": achievements_state(conn, session),
        "milestones": b["milestones"],
        "tasks_done": sum(1 for t in b["tasks"] if t["stage"] == "Сдача"),
        "tasks_total": len(b["tasks"]),
        "probe": probe_state(conn, session, None),
        "notice": last_notice,
        "table": {"shared": len(insights.shared_facts(conn, session)),
                  "key_total": len(insights.key_facts_in_play(conn, session))},
    }
