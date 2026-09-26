"""Сборка состояния для экранов участника и ведущего."""

from __future__ import annotations

from . import content
from .core import current_sprint, now


def roster(conn, team_id: str) -> list[dict]:
    return conn.execute(
        """SELECT p.participant_id, p.role AS role_title, d.role_slug, m.person AS display_name
             FROM research.participant p
             JOIN app.device d ON d.participant_id = p.participant_id
             LEFT JOIN identity.participant_map m ON m.participant_id = p.participant_id
            WHERE p.team_id = %s ORDER BY p.participant_id""",
        (team_id,),
    ).fetchall()


def roles_availability(conn, team_id: str, scenario: dict) -> list[dict]:
    taken = {
        r["role_slug"]: r["n"]
        for r in conn.execute(
            """SELECT role_slug, count(*) AS n FROM app.device
                WHERE team_id = %s AND participant_id IS NOT NULL GROUP BY role_slug""",
            (team_id,),
        ).fetchall()
    }
    return [
        {"slug": r["slug"], "title": r["title"], "department": r["department"], "summary": r["summary"],
         "capacity": r["capacity"], "taken": taken.get(r["slug"], 0)}
        for r in scenario["roles"]
    ]


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
        "now": now(),
    }


def board(conn, session: dict, role_slug: str | None = None, admin: bool = False) -> dict:
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
    notices = conn.execute(
        """SELECT notice_id, roles, title, body, created_at FROM app.notice
            WHERE team_id = %s AND session_id = %s
              AND (%s OR roles IS NULL OR %s = ANY(roles))
            ORDER BY created_at DESC""",
        (team_id, session_id, admin, role_slug),
    ).fetchall()
    decisions = conn.execute(
        """SELECT decision_id, case_id, proposed_by, alternatives, chosen, rationale, decided_at
             FROM research.decision WHERE team_id = %s AND session_id = %s ORDER BY decided_at DESC""",
        (team_id, session_id),
    ).fetchall()
    prefix = f"{team_id}/{session_id}/"
    for d in decisions:
        d["key_decision"] = bool(d["case_id"] and "/DECISION-" in d["case_id"])
        d["case_id"] = d["case_id"][len(prefix):] if d["case_id"] and d["case_id"].startswith(prefix) else d["case_id"]
    return {"tasks": tasks, "milestones": milestones, "notices": notices, "decisions": decisions}


def scenario_public(sc: dict, role_slug: str | None, condition: str) -> dict:
    role = content.role(sc, role_slug)
    return {
        "version": sc["version"],
        "title": sc["title"],
        "description": sc["description"],
        "legend": sc["legend"],
        "shared_facts": sc["shared_facts"],
        "decision": {k: v for k, v in sc["decision"].items() if k != "correct"},
        "condition": {"key": condition, **sc["conditions"][condition]},
        "my_role": role,
    }


def survey_status(conn, session: dict, participant_id: str | None) -> dict | None:
    phase = session["phase"]
    spec = content.phase_spec(phase)
    if spec is None or participant_id is None:
        return None
    done = conn.execute(
        """SELECT 1 FROM research.survey_response
            WHERE participant_id = %s AND team_id = %s AND session_id = %s AND phase = %s LIMIT 1""",
        (participant_id, session["team_id"], session["session_id"], phase),
    ).fetchone() is not None
    return {"done": done, **spec}
