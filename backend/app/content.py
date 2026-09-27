"""Сценарии, опросники и протоколы — версионируемые JSON-файлы (раздел 08, «воспроизводимость»)."""

from __future__ import annotations

import copy
import json
from functools import cache

from . import config

# Каталог механик: ключ → (название, группа, описание). Порядок — порядок показа в Лаборатории.
MECHANICS: list[dict] = [
    {"key": "facts", "group": "Скрытый профиль", "title": "Общий стол фактов",
     "text": "У каждой роли свои факты. Их можно выложить на стол — система фиксирует, что и когда стало общим."},
    {"key": "preference", "group": "Скрытый профиль", "title": "Личный выбор до обсуждения",
     "text": "На брифинге каждый втайне выбирает вариант. Классическая мера парадигмы скрытого профиля."},
    {"key": "vote", "group": "Скрытый профиль", "title": "Голосование на столе",
     "text": "Команда голосует за платформу и фиксирует решение."},
    {"key": "votes_visible", "group": "Скрытый профиль", "title": "Голоса видны сразу",
     "text": "Если выключить — голоса скрыты до фиксации решения (меньше конформизма)."},
    {"key": "chat", "group": "Коммуникация", "title": "Эфир",
     "text": "Командный чат с упоминаниями. В режиме тишины — единственный канал."},
    {"key": "help", "group": "Взаимопомощь", "title": "«Нужна помощь»",
     "text": "Сигнал о помощи и отклик на него — поведенческий маркер психологической безопасности."},
    {"key": "kudos", "group": "Взаимопомощь", "title": "«Спасибо»",
     "text": "Благодарность коллеге с указанием, за что. Строит сеть признания."},
    {"key": "weather", "group": "Взаимопомощь", "title": "Погода в команде",
     "text": "Каждый в любой момент отмечает своё состояние: от ясно до бури."},
    {"key": "probes", "group": "Проверки", "title": "Синхрон",
     "text": "Короткий вопрос всей команде сразу. Совпадение ответов показывает, есть ли общая картина."},
    {"key": "forecast", "group": "Проверки", "title": "Прогноз",
     "text": "Перед работой команда прогнозирует результат. На разборе — прогноз против реальности."},
    {"key": "check", "group": "Проверки", "title": "Проверка понимания правил",
     "text": "Manipulation check: поняли ли участники правила своей методики."},
    {"key": "mirror", "group": "Проверки", "title": "Зеркало",
     "text": "Участники угадывают состояние команды — насколько хорошо вы понимаете друг друга."},
    {"key": "charter", "group": "Рефлексия", "title": "Командный договор",
     "text": "Цель, способ принятия решений и сигналы о проблемах — до начала работы."},
    {"key": "retro", "group": "Рефлексия", "title": "Ретро и договорённости",
     "text": "Начать / перестать / продолжить, голосование. Договорённости проверяются в следующей сессии."},
    {"key": "strengths", "group": "Рефлексия", "title": "Сильные стороны",
     "text": "Каждый отмечает сильную сторону коллег. Адресат видит итог анонимно."},
    {"key": "achievements", "group": "Обратная связь", "title": "Командные достижения",
     "text": "Отметки за взаимодействие: «Все карты на столе», «Никого не бросили»…"},
    {"key": "synergy", "group": "Обратная связь", "title": "Сыгранность видна команде",
     "text": "Живой индекс сыгранности и уровень — от «Фрагментов» до «Картины»."},
    {"key": "nudges", "group": "Обратная связь", "title": "Подсказки системы",
     "text": "Система сама замечает застрявшие задачи, перегруз и неотвеченные просьбы."},
]
MECHANIC_KEYS = [m["key"] for m in MECHANICS]

INTERVENTIONS: list[dict] = [
    {"kind": "inject", "title": "Вброс сценария", "text": "Событие из легенды: срочный заказ, урезание бюджета…"},
    {"kind": "probe", "title": "Синхрон", "text": "Вопрос всей команде на 45 секунд."},
    {"kind": "silence", "title": "Тишина", "text": "Говорить вслух нельзя — только Эфир. Проверяет письменную коммуникацию."},
    {"kind": "blind_spot", "title": "Выезд к клиенту", "text": "Участник на несколько минут выпадает из работы. Кто подхватит?"},
    {"kind": "role_swap", "title": "Смена ролей", "text": "Двое меняются ролями: взгляд на процесс с другой стороны."},
    {"kind": "nudge", "title": "Подсказка", "text": "Сообщение ведущего команде или одному участнику."},
]

LEVELS = [
    (0, "Фрагменты", "Каждый пока сам по себе"),
    (20, "Эскиз", "Контуры команды проступают"),
    (40, "Узор", "Появляются устойчивые связи"),
    (60, "Мозаика", "Фрагменты складываются в целое"),
    (80, "Картина", "Команда работает как одно целое"),
]


def _normalize(sc: dict) -> dict:
    """Приводит сценарии 0.1 к формату 0.2: id фактов, главы легенды, пустые банки механик."""
    sc = copy.deepcopy(sc)
    sc["legend"] = [x if isinstance(x, dict) else {"title": "", "text": x} for x in sc.get("legend", [])]
    for role in sc["roles"]:
        role["facts"] = [
            f if isinstance(f, dict) else {"id": f"{role['slug']}.{i}", "text": f}
            for i, f in enumerate(role.get("facts", []), start=1)
        ]
        role.setdefault("home_stages", [])
        role.setdefault("colors", [])
    for key, default in [("probes", []), ("kudos", []), ("strengths", []), ("weather", []),
                         ("achievements", []), ("charter", []), ("checks", None)]:
        sc.setdefault(key, default)
    sc["decision"].setdefault("explanation", "")
    for opt in sc["decision"]["options"]:
        opt.setdefault("subtitle", "")
    for cond in sc["conditions"].values():
        cond.setdefault("tagline", "")
    for inj in sc.get("injects", []):
        inj.setdefault("icon", "zap")
    return sc


@cache
def scenarios() -> dict[str, dict]:
    result = {}
    for path in sorted((config.CONTENT_DIR / "scenarios").glob("*.json")):
        data = _normalize(json.loads(path.read_text(encoding="utf-8")))
        result[data["version"]] = data
    return result


def scenario(version: str) -> dict:
    return scenarios()[version]


def default_scenario() -> str:
    return sorted(scenarios())[-1]


@cache
def surveys() -> dict:
    return json.loads((config.CONTENT_DIR / "instruments" / "surveys.json").read_text(encoding="utf-8"))


@cache
def builtin_protocols() -> list[dict]:
    order = ["standard", "feedback_off", "nudges", "minimal", "demo"]
    items = [json.loads(p.read_text(encoding="utf-8")) for p in (config.CONTENT_DIR / "protocols").glob("*.json")]
    return sorted(items, key=lambda p: order.index(p["protocol_id"]) if p["protocol_id"] in order else 99)


def role(sc: dict, slug: str | None) -> dict | None:
    return next((r for r in sc["roles"] if r["slug"] == slug), None)


def all_facts(sc: dict) -> dict[str, dict]:
    """fact_id → {id, text, key, role, role_title}."""
    return {f["id"]: {**f, "role": r["slug"], "role_title": r["title"]} for r in sc["roles"] for f in r["facts"]}


def key_facts(sc: dict) -> set[str]:
    return {fid for fid, f in all_facts(sc).items() if f.get("key")}


def level(score: float) -> dict:
    current = LEVELS[0]
    for lv in LEVELS:
        if score >= lv[0]:
            current = lv
    idx = LEVELS.index(current)
    nxt = LEVELS[idx + 1][0] if idx + 1 < len(LEVELS) else 100
    return {"index": idx, "title": current[1], "text": current[2], "from": current[0], "to": nxt}


def mechanics(raw: dict | None) -> dict[str, bool]:
    """Флаги механик сессии. Сессии версии 0.1 (без протокола) — всё выключено."""
    raw = raw or {}
    return {k: bool(raw.get(k, False)) for k in MECHANIC_KEYS}


def phase_spec(phase: str) -> dict | None:
    s = surveys()
    spec = s["phases"].get(phase)
    if spec is None:
        return None
    return {
        "phase": phase,
        "instruments": [{"id": i, **s["instruments"][i]} for i in spec["instruments"]],
        "nominations": s["nominations"] if spec.get("nominations") else None,
        "mirror": s["mirror"] if spec.get("mirror") else None,
        "strengths": bool(spec.get("strengths")),
        "agreements": bool(spec.get("agreements")),
    }
