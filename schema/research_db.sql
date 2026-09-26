-- Исследовательская БД Tessera (PostgreSQL 13+). Разделы 05, 08, 09 концепции.
--
-- Схема research — только псевдонимы, её можно выгружать и анализировать.
-- Схема identity — таблица соответствия псевдоним ↔ человек. Доступ только у ответственного,
-- после завершения сбора: DROP SCHEMA identity CASCADE;

CREATE SCHEMA IF NOT EXISTS research;
CREATE SCHEMA IF NOT EXISTS identity;

-- ---------------------------------------------------------------- сценарий и условия
CREATE TABLE research.scenario_version (
    scenario_version text PRIMARY KEY,           -- например, 'meridian-0.1'
    description      text,
    snapshot_ref     text,                       -- ссылка на «чистый» снимок компании в ERP
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research.team (
    team_id text PRIMARY KEY                     -- 'T-03'
);

CREATE TABLE research.session (
    team_id          text NOT NULL REFERENCES research.team,
    session_id       text NOT NULL,              -- 'S-2'
    condition        text NOT NULL CHECK (condition IN ('kanban', 'sprints', 'hierarchy', 'self_org')),
    scenario_version text NOT NULL REFERENCES research.scenario_version,
    facilitator      text,                       -- псевдоним ведущего
    started_at       timestamptz,
    ended_at         timestamptz,
    notes            text,                       -- заметки ведущего с дебрифинга
    PRIMARY KEY (team_id, session_id)
);

CREATE TABLE research.participant (
    participant_id text PRIMARY KEY,             -- 'P-07'
    team_id        text NOT NULL REFERENCES research.team,
    role           text,                         -- роль в сценарии: аналитик, финансист, ...
    department     text,                         -- отдел вымышленной компании
    consent_at     timestamptz NOT NULL          -- без согласия участника в базе нет
);

CREATE TABLE identity.participant_map (
    participant_id text PRIMARY KEY REFERENCES research.participant ON DELETE CASCADE,
    person         text NOT NULL,                -- ФИО или логин
    UNIQUE (person)
);

-- ---------------------------------------------------------------- журнал событий
-- Поля совпадают с tessera.model.FIELDS; выгрузка в CSV читается `python -m tessera`.
CREATE TABLE research.event (
    event_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id      text        NOT NULL,           -- задача, заказ, веха
    activity     text        NOT NULL,
    ts           timestamptz NOT NULL,
    resource     text        NOT NULL REFERENCES research.participant,
    role         text,
    department   text,
    team_id      text        NOT NULL,
    session_id   text        NOT NULL,
    milestone_id text,
    attrs        jsonb       NOT NULL DEFAULT '{}'::jsonb,   -- {"old": ..., "new": ...}
    recorded_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE INDEX event_case_ts ON research.event (case_id, ts);
CREATE INDEX event_session_ts ON research.event (team_id, session_id, ts);

-- Журнал неизменяем: события только добавляются.
CREATE FUNCTION research.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'research.% is append-only', TG_TABLE_NAME;
END $$;

CREATE TRIGGER event_append_only BEFORE UPDATE OR DELETE ON research.event
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- Вбросы ведущего: метка события, по которой потом смотрят реакцию процесса.
CREATE TABLE research.inject (
    inject_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id    text        NOT NULL,
    session_id text        NOT NULL,
    kind       text        NOT NULL,             -- 'urgent_order', 'budget_cut', 'key_person_left', ...
    ts         timestamptz NOT NULL,
    payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER inject_append_only BEFORE UPDATE OR DELETE ON research.inject
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- Журнал решений: кто предложил, альтернативы, когда приняли, обоснование.
CREATE TABLE research.decision (
    decision_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id      text        NOT NULL,
    session_id   text        NOT NULL,
    case_id      text,
    proposed_by  text        NOT NULL REFERENCES research.participant,
    alternatives jsonb       NOT NULL DEFAULT '[]'::jsonb,
    chosen       text        NOT NULL,
    rationale    text,
    decided_at   timestamptz NOT NULL,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- ---------------------------------------------------------------- опросы и оценки
-- phase: entry — входной замер, pulse — после сессии, exit — выходной замер.
CREATE TABLE research.survey_response (
    participant_id text        NOT NULL REFERENCES research.participant,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    phase          text        NOT NULL CHECK (phase IN ('entry', 'pulse', 'exit')),
    instrument     text        NOT NULL,         -- 'psych_safety_7', 'nasa_tlx_raw', 'goal_clarity', ...
    item           text        NOT NULL,         -- номер или код пункта
    value          numeric     NOT NULL,
    answered_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (participant_id, session_id, phase, instrument, item),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- Сетевые вопросы: «к кому обращались», «чей вклад полезен», «кто фактически руководил».
CREATE TABLE research.peer_nomination (
    from_participant text NOT NULL REFERENCES research.participant,
    to_participant   text NOT NULL REFERENCES research.participant,
    team_id          text NOT NULL,
    session_id       text NOT NULL,
    question         text NOT NULL CHECK (question IN ('asked_for_info', 'most_useful', 'actual_leader')),
    weight           smallint NOT NULL DEFAULT 1,
    PRIMARY KEY (from_participant, to_participant, session_id, question),
    CHECK (from_participant <> to_participant),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- ---------------------------------------------------------------- выгрузка
-- CSV в формате tessera.model:  \copy (SELECT * FROM research.event_log) TO 'log.csv' CSV HEADER
CREATE VIEW research.event_log AS
SELECT e.case_id,
       e.activity,
       e.ts AS "timestamp",
       e.resource,
       coalesce(e.role, p.role, '')             AS role,
       coalesce(e.department, p.department, '') AS department,
       e.team_id,
       e.session_id,
       s.condition,
       coalesce(e.milestone_id, '') AS milestone_id,
       CASE WHEN e.attrs = '{}'::jsonb THEN '' ELSE e.attrs::text END AS attrs
FROM research.event e
JOIN research.session s USING (team_id, session_id)
JOIN research.participant p ON p.participant_id = e.resource
ORDER BY e.ts, e.event_id;
