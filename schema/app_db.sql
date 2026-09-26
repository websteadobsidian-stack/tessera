-- Операционная схема приложения Tessera: состояние компании «Меридиан» во время сессии.
-- Исследовательские данные (журнал, опросы, оценки) живут в research.* — см. research_db.sql.
-- Таблицы app.* можно пересобрать; research.* — нет.

CREATE SCHEMA IF NOT EXISTS app;

CREATE TABLE app.admin_token (
    token      text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Команда: код входа, методика и сценарий, которые наследуют все её сессии.
CREATE TABLE app.team_settings (
    team_id          text PRIMARY KEY REFERENCES research.team,
    join_code        text NOT NULL UNIQUE,
    condition        text NOT NULL CHECK (condition IN ('kanban', 'sprints', 'hierarchy', 'self_org')),
    scenario_version text NOT NULL REFERENCES research.scenario_version,
    label            text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.session_state (
    team_id          text NOT NULL,
    session_id       text NOT NULL,
    phase            text NOT NULL DEFAULT 'lobby'
                     CHECK (phase IN ('lobby', 'entry', 'briefing', 'work', 'pulse', 'debrief', 'exit', 'closed')),
    phase_changed_at timestamptz NOT NULL DEFAULT now(),
    work_started_at  timestamptz,
    work_minutes     int NOT NULL DEFAULT 50,
    wip_limit        int NOT NULL DEFAULT 3,
    sprint_minutes   int NOT NULL DEFAULT 15,
    PRIMARY KEY (team_id, session_id),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- Браузер участника. participant_id появляется только после согласия.
CREATE TABLE app.device (
    token          text PRIMARY KEY,
    team_id        text NOT NULL REFERENCES research.team,
    participant_id text UNIQUE REFERENCES research.participant,
    role_slug      text,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.milestone (
    milestone_id    text PRIMARY KEY,            -- 'T-03/S-1/M-1'
    team_id         text NOT NULL,
    session_id      text NOT NULL,
    key             text NOT NULL,               -- 'M-1'
    title           text NOT NULL,
    offset_minutes  int  NOT NULL,               -- срок от начала работы
    deadline        timestamptz,                 -- выставляется при старте рабочей фазы
    closed_at       timestamptz,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

CREATE TABLE app.task (
    case_id     text PRIMARY KEY,                -- 'T-03/S-1/T05' — уникален во всём журнале
    team_id     text NOT NULL,
    session_id  text NOT NULL,
    key         text NOT NULL,
    title       text NOT NULL,
    description text NOT NULL DEFAULT '',
    project     text NOT NULL DEFAULT '',
    priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'urgent')),
    milestone_id text REFERENCES app.milestone,
    stage       text NOT NULL DEFAULT 'Бэклог',
    assignee    text REFERENCES research.participant,
    started     boolean NOT NULL DEFAULT false,
    sprint      int,
    inject_id   bigint REFERENCES research.inject,
    position    int NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, session_id, key),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- Сообщения команде: вбросы ведущего и системные уведомления.
CREATE TABLE app.notice (
    notice_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id    text NOT NULL,
    session_id text NOT NULL,
    inject_id  bigint REFERENCES research.inject,
    roles      text[],                           -- NULL — всем; иначе только этим ролям
    title      text NOT NULL,
    body       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
