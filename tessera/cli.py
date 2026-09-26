"""Командная строка: python -m tessera <команда> …"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

from . import export, metrics
from .model import EventLogError, read_csv, write_csv
from .pseudonymize import Pseudonymizer
from .simulate import simulate


def _write_rows(rows: list[dict], path: Path) -> None:
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)


def cmd_simulate(a):
    events = simulate(teams_per_condition=a.teams, seed=a.seed)
    write_csv(events, a.out)
    print(f"{len(events)} событий → {a.out}")


def cmd_validate(a):
    events = read_csv(a.log)
    print(f"OK: {len(events)} событий, {len({e.case_id for e in events})} кейсов, "
          f"{len({e.team_key for e in events})} команд-сессий")


def cmd_pseudonymize(a):
    mapping = Path(a.mapping)
    p = Pseudonymizer.load(mapping) if mapping.exists() else Pseudonymizer()
    write_csv(p.apply(read_csv(a.log)), a.out)
    p.save(mapping)
    print(f"журнал → {a.out}; таблица соответствия → {mapping} (хранить отдельно!)")


def cmd_metrics(a):
    events = read_csv(a.log)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    teams = metrics.summarize(events)
    _write_rows(teams, out / "teams.csv")
    cases = metrics.case_table(events)
    if cases:
        _write_rows(cases, out / "cases.csv")
    edges = metrics.handover_network(events)
    _write_rows([{"source": s, "target": t, "weight": w} for (s, t), w in edges.items()]
                or [{"source": "", "target": "", "weight": 0}], out / "handover.csv")
    conditions = metrics.by_condition(teams)
    (out / "conditions.json").write_text(json.dumps(conditions, ensure_ascii=False, indent=2),
                                         encoding="utf-8")
    print(f"teams.csv, cases.csv, handover.csv, conditions.json → {out}")
    for cond, agg in conditions.items():
        def fmt(k):
            v = agg.get(k)
            return "—" if v is None else f"{v:.2f}"
        print(f"  {cond:10} команд={agg['teams']}  цикл,ч={fmt('cycle_hours_mean')}  "
              f"ожидание,ч={fmt('waiting_hours_mean')}  доработки={fmt('rework_case_share')}  "
              f"fitness={fmt('fitness_mean')}  централизация={fmt('handover_centralization')}")


def cmd_export(a):
    events = read_csv(a.log)
    (export.to_xes if a.format == "xes" else export.to_ocel2)(events, a.out)
    print(f"{a.format.upper()} → {a.out}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="tessera", description="Конвейер данных Tessera")
    sub = ap.add_subparsers(required=True)

    s = sub.add_parser("simulate", help="синтетический журнал «Меридиана» для прогона")
    s.add_argument("--teams", type=int, default=2, help="команд на условие")
    s.add_argument("--seed", type=int, default=42)
    s.add_argument("--out", default="data/synthetic_log.csv")
    s.set_defaults(func=cmd_simulate)

    s = sub.add_parser("validate", help="проверить CSV-журнал")
    s.add_argument("log")
    s.set_defaults(func=cmd_validate)

    s = sub.add_parser("pseudonymize", help="заменить исполнителей кодами")
    s.add_argument("log")
    s.add_argument("--out", required=True)
    s.add_argument("--mapping", required=True, help="CSV соответствия (дополняется)")
    s.set_defaults(func=cmd_pseudonymize)

    s = sub.add_parser("metrics", help="процессные и сетевые метрики")
    s.add_argument("log")
    s.add_argument("--out", default="out")
    s.set_defaults(func=cmd_metrics)

    s = sub.add_parser("export", help="выгрузка в XES или OCEL 2.0")
    s.add_argument("log")
    s.add_argument("--format", choices=["xes", "ocel"], default="xes")
    s.add_argument("--out", required=True)
    s.set_defaults(func=cmd_export)

    a = ap.parse_args(argv)
    try:
        a.func(a)
    except EventLogError as e:
        print(f"ошибка журнала: {e}", file=sys.stderr)
        return 1
    return 0
