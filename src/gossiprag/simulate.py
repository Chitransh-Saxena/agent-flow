"""CLI: run a scenario, write its trace to traces/<scenario>.trace.json.

    python -m gossiprag run --scenario byzantine-minority
    python -m gossiprag run --all
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .protocol import run_simulation
from .scenarios import SCENARIOS

REPO_ROOT = Path(__file__).resolve().parents[2]
TRACES_DIR = REPO_ROOT / "traces"


def _run_one(scenario_id: str) -> Path:
    builder = SCENARIOS[scenario_id]
    config = builder()
    trace = run_simulation(config)
    TRACES_DIR.mkdir(exist_ok=True)
    out_path = TRACES_DIR / f"{scenario_id}.trace.json"
    out_path.write_text(json.dumps(trace.to_json(), indent=2))
    return out_path


def _write_manifest() -> None:
    manifest = [
        {"id": sid, "title": builder().title, "file": f"{sid}.trace.json"}
        for sid, builder in SCENARIOS.items()
    ]
    (TRACES_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="gossiprag")
    sub = parser.add_subparsers(dest="command", required=True)

    run_p = sub.add_parser("run", help="run one or all scenarios and write trace files")
    group = run_p.add_mutually_exclusive_group(required=True)
    group.add_argument("--scenario", choices=sorted(SCENARIOS), help="scenario id to run")
    group.add_argument("--all", action="store_true", help="run every scenario")

    args = parser.parse_args(argv)

    if args.command == "run":
        scenario_ids = list(SCENARIOS) if args.all else [args.scenario]
        for sid in scenario_ids:
            out_path = _run_one(sid)
            print(f"wrote {out_path.relative_to(REPO_ROOT)}")
        _write_manifest()
        print(f"wrote {(TRACES_DIR / 'manifest.json').relative_to(REPO_ROOT)}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
