-- 0003 · Механики командного взаимодействия, протоколы экспериментов, демо-режим.
--
-- research.* — данные исследования (только псевдонимы). Таблицы-журналы неизменяемы;
-- исключение одно: данные демо-команд можно удалить целиком (research.purge_demo_team).
-- app.*      — операционное состояние сессий, его можно пересобрать.

-- ================================================================ демо и протоколы

ALTER TABLE research.team ADD COLUMN is_demo boolean NOT NULL DEFAULT false;
ALTER TABLE research.session ADD COLUMN protocol jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION research.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM research.team t WHERE t.team_id = OLD.team_id AND t.is_demo) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'research.% is append-only', TG_TABLE_NAME;
END $$;

-- В журнале решений 0.1 терялся заголовок решения.
ALTER TABLE research.decision ADD COLUMN title text;

-- Брифинг тоже собирает ответы: прогноз, проверка понимания правил.
ALTER TABLE research.survey_response DROP CONSTRAINT IF EXISTS survey_response_phase_check;
ALTER TABLE research.survey_response ADD CONSTRAINT survey_response_phase_check
    CHECK (phase IN ('entry', 'briefing', 'pulse', 'exit'));

-- ================================================================ скрытый профиль

-- Факт роли выложен на общий стол: когда и кем.
CREATE TABLE research.fact_share (
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    fact_id        text        NOT NULL,          -- 'finance.1' из сценария
    participant_id text        NOT NULL REFERENCES research.participant,
    shared_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (team_id, session_id, fact_id),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER fact_share_append_only BEFORE UPDATE OR DELETE ON research.fact_share
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- Личный выбор до обсуждения (pre) — классическая мера парадигмы скрытого профиля.
CREATE TABLE research.preference (
    participant_id text        NOT NULL REFERENCES research.participant,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    stage          text        NOT NULL CHECK (stage IN ('pre', 'post')),
    option         text        NOT NULL,
    confidence     smallint    CHECK (confidence BETWEEN 1 AND 5),
    answered_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (participant_id, team_id, session_id, stage),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- Голоса на общем столе: вся история, текущий голос — последний.
CREATE TABLE research.vote_log (
    vote_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    participant_id text        NOT NULL REFERENCES research.participant,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    option         text        NOT NULL,
    voted_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER vote_log_append_only BEFORE UPDATE OR DELETE ON research.vote_log
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- ================================================================ взаимодействие

CREATE TABLE research.kudos (
    kudos_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id          text        NOT NULL,
    session_id       text        NOT NULL,
    from_participant text        NOT NULL REFERENCES research.participant,
    to_participant   text        NOT NULL REFERENCES research.participant,
    kind             text        NOT NULL,
    note             text,
    sent_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (from_participant <> to_participant),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER kudos_append_only BEFORE UPDATE OR DELETE ON research.kudos
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- Просьба о помощи — поведенческий маркер психологической безопасности.
CREATE TABLE research.help_request (
    help_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    participant_id text        NOT NULL REFERENCES research.participant,
    case_id        text,
    note           text,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    helper_id      text REFERENCES research.participant,
    helped_at      timestamptz,
    resolved_at    timestamptz,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE INDEX help_request_session ON research.help_request (team_id, session_id, created_at);

-- «Погода» участника: 1 — буря, 4 — ясно.
CREATE TABLE research.mood (
    mood_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    participant_id text        NOT NULL REFERENCES research.participant,
    value          smallint    NOT NULL CHECK (value BETWEEN 1 AND 4),
    set_at         timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER mood_append_only BEFORE UPDATE OR DELETE ON research.mood
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- Эфир: в исследовательской схеме только метаданные сообщения, текст — в app.message_body.
CREATE TABLE research.message (
    message_id     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    participant_id text        NOT NULL REFERENCES research.participant,
    mentions       text[]      NOT NULL DEFAULT '{}',
    length         int         NOT NULL,
    case_key       text,
    during_silence boolean     NOT NULL DEFAULT false,
    sent_at        timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE INDEX message_session ON research.message (team_id, session_id, sent_at);
CREATE TRIGGER message_append_only BEFORE UPDATE OR DELETE ON research.message
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- ================================================================ проверки и эксперименты

-- «Синхрон»: короткий вопрос всей команде; совпадение ответов — мера общей картины.
CREATE TABLE research.probe (
    probe_id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id    text        NOT NULL,
    session_id text        NOT NULL,
    kind       text        NOT NULL,
    question   text        NOT NULL,
    options    jsonb       NOT NULL,
    truth      text,
    source     text        NOT NULL DEFAULT 'facilitator',
    fired_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    closes_at  timestamptz NOT NULL,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER probe_append_only BEFORE UPDATE OR DELETE ON research.probe
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

CREATE TABLE research.probe_answer (
    probe_id       bigint      NOT NULL REFERENCES research.probe ON DELETE CASCADE,
    participant_id text        NOT NULL REFERENCES research.participant,
    answer         text        NOT NULL,
    answered_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (probe_id, participant_id)
);

-- Вмешательства ведущего и протокола: тишина, выезд, смена ролей, подсказки.
CREATE TABLE research.intervention (
    intervention_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id         text        NOT NULL,
    session_id      text        NOT NULL,
    kind            text        NOT NULL,
    payload         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    source          text        NOT NULL DEFAULT 'facilitator',
    started_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    ends_at         timestamptz,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE TRIGGER intervention_append_only BEFORE UPDATE OR DELETE ON research.intervention
    FOR EACH ROW EXECUTE FUNCTION research.forbid_change();

-- ================================================================ рефлексия

CREATE TABLE research.charter (
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    field          text        NOT NULL,
    body           text        NOT NULL,
    participant_id text        NOT NULL REFERENCES research.participant,
    updated_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (team_id, session_id, field),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

CREATE TABLE research.retro_card (
    card_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id        text        NOT NULL,
    session_id     text        NOT NULL,
    participant_id text        NOT NULL REFERENCES research.participant,
    lane           text        NOT NULL CHECK (lane IN ('start', 'stop', 'continue')),
    body           text        NOT NULL,
    created_at     timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

CREATE TABLE research.retro_vote (
    card_id        bigint NOT NULL REFERENCES research.retro_card ON DELETE CASCADE,
    participant_id text   NOT NULL REFERENCES research.participant,
    PRIMARY KEY (card_id, participant_id)
);

-- Договорённости переходят в следующую сессию команды и там проверяются.
CREATE TABLE research.agreement (
    agreement_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id      text        NOT NULL,
    session_id   text        NOT NULL,
    card_id      bigint REFERENCES research.retro_card ON DELETE SET NULL,
    body         text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (team_id, session_id, card_id),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

CREATE TABLE research.agreement_check (
    agreement_id   bigint      NOT NULL REFERENCES research.agreement ON DELETE CASCADE,
    participant_id text        NOT NULL REFERENCES research.participant,
    session_id     text        NOT NULL,              -- сессия, в которой проверяли
    score          smallint    NOT NULL CHECK (score BETWEEN 1 AND 5),
    answered_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (agreement_id, participant_id, session_id)
);

-- Сильные стороны, которые коллеги видят друг в друге (показываются адресату анонимно).
CREATE TABLE research.strength (
    from_participant text NOT NULL REFERENCES research.participant,
    to_participant   text NOT NULL REFERENCES research.participant,
    team_id          text NOT NULL,
    session_id       text NOT NULL,
    strength         text NOT NULL,
    PRIMARY KEY (from_participant, to_participant, team_id, session_id),
    CHECK (from_participant <> to_participant),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

CREATE TABLE research.achievement (
    team_id     text        NOT NULL,
    session_id  text        NOT NULL,
    key         text        NOT NULL,
    unlocked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (team_id, session_id, key),
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- ================================================================ операционная часть

ALTER TABLE app.team_settings
    ADD COLUMN is_demo     boolean NOT NULL DEFAULT false,
    ADD COLUMN demo_kind   text CHECK (demo_kind IN ('sandbox', 'history')),
    ADD COLUMN protocol_id text,
    ADD COLUMN bot_speed   real    NOT NULL DEFAULT 1;

ALTER TABLE app.session_state DROP CONSTRAINT IF EXISTS session_state_phase_check;
ALTER TABLE app.session_state ADD CONSTRAINT session_state_phase_check CHECK (phase IN (
    'lobby', 'entry', 'briefing', 'work', 'pulse', 'debrief', 'retro', 'exit', 'closed'));
ALTER TABLE app.session_state
    ADD COLUMN time_scale    real  NOT NULL DEFAULT 1,
    ADD COLUMN silence_until timestamptz,
    ADD COLUMN mechanics     jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE app.device
    ADD COLUMN color_slot     smallint,
    ADD COLUMN away_until     timestamptz,
    ADD COLUMN away_note      text,
    ADD COLUMN orig_role_slug text,
    ADD COLUMN swap_until     timestamptz,
    ADD COLUMN last_seen_at   timestamptz,
    ADD COLUMN is_bot         boolean NOT NULL DEFAULT false;

ALTER TABLE app.admin_token
    ADD COLUMN team_scope text REFERENCES research.team ON DELETE CASCADE,
    ADD COLUMN expires_at timestamptz;

ALTER TABLE app.notice
    ADD COLUMN kind           text NOT NULL DEFAULT 'inject',
    ADD COLUMN participant_id text,
    ADD COLUMN signal         text;

CREATE TABLE app.message_body (
    message_id bigint PRIMARY KEY REFERENCES research.message ON DELETE CASCADE,
    body       text NOT NULL
);

-- Протокол эксперимента: механики, параметры и таймлайн вмешательств.
CREATE TABLE app.protocol (
    protocol_id text PRIMARY KEY,
    title       text        NOT NULL,
    description text        NOT NULL DEFAULT '',
    config      jsonb       NOT NULL,
    builtin     boolean     NOT NULL DEFAULT false,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Запланированные вмешательства сессии (копия таймлайна протокола на момент старта).
CREATE TABLE app.schedule (
    item_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    team_id    text        NOT NULL,
    session_id text        NOT NULL,
    minute     real        NOT NULL,
    kind       text        NOT NULL,
    payload    jsonb       NOT NULL DEFAULT '{}'::jsonb,
    fired_at   timestamptz,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);
CREATE INDEX schedule_pending ON app.schedule (team_id, session_id) WHERE fired_at IS NULL;

-- Боты демо-команд.
CREATE TABLE app.bot (
    participant_id text PRIMARY KEY REFERENCES research.participant ON DELETE CASCADE,
    persona        jsonb       NOT NULL,
    next_action_at timestamptz NOT NULL DEFAULT now(),
    busy_case      text,
    busy_until     timestamptz,
    paused         boolean     NOT NULL DEFAULT false,
    memory         jsonb       NOT NULL DEFAULT '{}'::jsonb
);

-- ================================================================ удаление демо-команды

CREATE FUNCTION research.purge_demo_team(t text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM research.team WHERE team_id = t AND is_demo) THEN
        RAISE EXCEPTION 'team % is not a demo team', t;
    END IF;
    DELETE FROM app.admin_token WHERE team_scope = t;
    DELETE FROM app.bot WHERE participant_id IN (SELECT participant_id FROM research.participant WHERE team_id = t);
    DELETE FROM app.device WHERE team_id = t;
    DELETE FROM app.notice WHERE team_id = t;
    DELETE FROM app.schedule WHERE team_id = t;
    DELETE FROM app.task WHERE team_id = t;
    DELETE FROM app.milestone WHERE team_id = t;
    DELETE FROM app.session_state WHERE team_id = t;
    DELETE FROM app.team_settings WHERE team_id = t;
    DELETE FROM research.agreement_check WHERE agreement_id IN (SELECT agreement_id FROM research.agreement WHERE team_id = t);
    DELETE FROM research.agreement WHERE team_id = t;
    DELETE FROM research.retro_vote WHERE card_id IN (SELECT card_id FROM research.retro_card WHERE team_id = t);
    DELETE FROM research.retro_card WHERE team_id = t;
    DELETE FROM research.strength WHERE team_id = t;
    DELETE FROM research.achievement WHERE team_id = t;
    DELETE FROM research.charter WHERE team_id = t;
    DELETE FROM research.probe_answer WHERE probe_id IN (SELECT probe_id FROM research.probe WHERE team_id = t);
    DELETE FROM research.probe WHERE team_id = t;
    DELETE FROM research.intervention WHERE team_id = t;
    DELETE FROM research.message WHERE team_id = t;
    DELETE FROM research.mood WHERE team_id = t;
    DELETE FROM research.help_request WHERE team_id = t;
    DELETE FROM research.kudos WHERE team_id = t;
    DELETE FROM research.vote_log WHERE team_id = t;
    DELETE FROM research.preference WHERE team_id = t;
    DELETE FROM research.fact_share WHERE team_id = t;
    DELETE FROM research.peer_nomination WHERE team_id = t;
    DELETE FROM research.survey_response WHERE team_id = t;
    DELETE FROM research.decision WHERE team_id = t;
    DELETE FROM research.event WHERE team_id = t;
    DELETE FROM research.inject WHERE team_id = t;
    DELETE FROM identity.participant_map WHERE participant_id IN (SELECT participant_id FROM research.participant WHERE team_id = t);
    DELETE FROM research.participant WHERE team_id = t;
    DELETE FROM research.session WHERE team_id = t;
    DELETE FROM research.team WHERE team_id = t;
END $$;
