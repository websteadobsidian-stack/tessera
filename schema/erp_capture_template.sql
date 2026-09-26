-- ШАБЛОН захвата истории изменений из ERP (раздел 08: «журнал как первичный источник»).
--
-- Структура ERP здесь условная: таблица erp.task(id, status, assignee_id, due_date, milestone_id)
-- и справочник пользователей песочницы. Перед применением заменить имена таблиц и колонок
-- на реальные — это результат шага «Аудит ERP». Если ERP уже пишет историю изменений,
-- триггер не нужен: достаточно представления поверх её таблицы истории.
--
-- Требует research_db.sql и таблицу сопоставления пользователей песочницы с псевдонимами
-- и командой/сессией, заполняемую при брифинге.

CREATE TABLE IF NOT EXISTS research.sandbox_user (
    erp_user_id    bigint PRIMARY KEY,           -- пользователь в экземпляре-песочнице
    participant_id text NOT NULL REFERENCES research.participant,
    team_id        text NOT NULL,
    session_id     text NOT NULL,
    FOREIGN KEY (team_id, session_id) REFERENCES research.session
);

-- Соответствие статусов ERP этапам эталонного процесса (tessera.model.STAGES).
CREATE TABLE IF NOT EXISTS research.status_stage (
    erp_status text PRIMARY KEY,
    activity   text NOT NULL                     -- 'Анализ', 'Проектирование', ..., 'Взята в работу'
);

CREATE OR REPLACE FUNCTION research.capture_task_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    -- Кто сделал изменение: ERP должна передавать пользователя, например SET LOCAL erp.user_id = ...
    actor research.sandbox_user;
    act   text;
BEGIN
    SELECT * INTO actor FROM research.sandbox_user
     WHERE erp_user_id = nullif(current_setting('erp.user_id', true), '')::bigint;
    IF actor IS NULL THEN
        RETURN NEW;                              -- изменение вне сессии (подготовка сценария)
    END IF;

    IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        SELECT activity INTO act FROM research.status_stage WHERE erp_status = NEW.status;
        INSERT INTO research.event (case_id, activity, ts, resource, team_id, session_id,
                                    milestone_id, attrs)
        VALUES ('TASK-' || NEW.id, coalesce(act, NEW.status), clock_timestamp(),
                actor.participant_id, actor.team_id, actor.session_id, NEW.milestone_id::text,
                CASE WHEN TG_OP = 'UPDATE'
                     THEN jsonb_build_object('old', OLD.status, 'new', NEW.status)
                     ELSE '{}'::jsonb END);
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.assignee_id IS DISTINCT FROM OLD.assignee_id THEN
        INSERT INTO research.event (case_id, activity, ts, resource, team_id, session_id,
                                    milestone_id, attrs)
        VALUES ('TASK-' || NEW.id, 'Переназначена', clock_timestamp(), actor.participant_id,
                actor.team_id, actor.session_id, NEW.milestone_id::text,
                jsonb_build_object(
                    'old', (SELECT participant_id FROM research.sandbox_user WHERE erp_user_id = OLD.assignee_id),
                    'new', (SELECT participant_id FROM research.sandbox_user WHERE erp_user_id = NEW.assignee_id)));
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.due_date IS DISTINCT FROM OLD.due_date THEN
        INSERT INTO research.event (case_id, activity, ts, resource, team_id, session_id,
                                    milestone_id, attrs)
        VALUES ('TASK-' || NEW.id, 'Изменён срок', clock_timestamp(), actor.participant_id,
                actor.team_id, actor.session_id, NEW.milestone_id::text,
                jsonb_build_object('old', OLD.due_date, 'new', NEW.due_date));
    END IF;

    RETURN NEW;
END $$;

CREATE TRIGGER task_capture AFTER INSERT OR UPDATE ON erp.task
    FOR EACH ROW EXECUTE FUNCTION research.capture_task_change();
