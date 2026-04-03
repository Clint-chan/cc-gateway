from __future__ import annotations

import argparse
import json
import subprocess
import sys
from collections import defaultdict
from datetime import UTC, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MITM_DIR = ROOT / "mitm"


def run_json_script(script_name: str, *args: str) -> dict:
    command = [sys.executable, str(MITM_DIR / script_name), *args]
    result = subprocess.run(
        command,
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def owner_summary(control_plane: dict) -> dict[str, list[str]]:
    buckets: dict[str, list[str]] = defaultdict(list)
    for row in control_plane["rows"]:
        buckets[row["inferred_owner"]].append(row["surface"])
    return dict(sorted(buckets.items()))


def stable_event_threshold(event_rows: list[dict]) -> tuple[str, int | None]:
    grouped: dict[str, dict[int, bool]] = defaultdict(dict)
    for row in event_rows:
        key = row["AuthMode"]
        repeat = int(row["RepeatCount"])
        delay = int(row["DelayMilliseconds"])
        hit = int(row["EventDirectCount"]) > 0 and int(row["EventGatewayCount"]) == 0
        grouped[f"{key}:{repeat}"][delay] = hit

    by_auth: dict[str, list[tuple[int, bool]]] = defaultdict(list)
    for compound, delays in grouped.items():
        auth_mode, repeat_raw = compound.split(":", 1)
        repeat = int(repeat_raw)
        by_auth[auth_mode].append((repeat, all(delays.values()) and len(delays) >= 3))

    for auth_mode, rows in by_auth.items():
        for repeat, stable in sorted(rows):
            if stable:
                return auth_mode, repeat
    return ("managed-oauth", None)


def probe_thresholds(event_probe_rows: list[dict]) -> dict[str, int | None]:
    per_probe: dict[str, list[int]] = defaultdict(list)
    for row in event_probe_rows:
        if int(row["EventDirectCount"]) > 0 and int(row["EventGatewayCount"]) == 0:
            per_probe[row["Probe"]].append(int(row["RepeatCount"]))

    result: dict[str, int | None] = {}
    for probe in sorted({row["Probe"] for row in event_probe_rows}):
        values = sorted(per_probe.get(probe, []))
        result[probe] = values[0] if values else None
    return result


def relation_summary(eval_matrix: dict) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for row in eval_matrix["rows"]:
        for relation in row["relations"].values():
            counts[relation] += 1
    return dict(sorted(counts.items()))


def render_markdown(
    *,
    label: str,
    control_plane: dict,
    eval_matrix: dict,
    event_rows: list[dict],
    event_probe_rows: list[dict],
) -> str:
    owners = owner_summary(control_plane)
    auth_mode, stable_repeat = stable_event_threshold(event_rows)
    probes = probe_thresholds(event_probe_rows)
    eval_relations = relation_summary(eval_matrix)

    lines = [
        f"# Telemetry Maintenance Report: {label}",
        "",
        f"- Generated at: {datetime.now(UTC).isoformat()}",
        "- Canonical research environment: local npm runtime",
        "- Deployment validation environment: Docker Compose",
        "",
        "## Executive Summary",
        "",
        "- Research captures should continue to use the local Node runtime as the primary baseline.",
        "- Docker remains a parity and packaging environment, not the default transport-facts baseline.",
        "- This report merges control-plane ownership, eval field relations, and event_logging trigger evidence.",
        "",
        "## Control-Plane Ownership",
        "",
    ]

    for owner, surfaces in owners.items():
        joined = ", ".join(sorted(surfaces))
        lines.append(f"- `{owner}`: {joined}")

    lines.extend(
        [
            "",
            "## Eval Field Relations",
            "",
        ]
    )
    for relation, count in eval_relations.items():
        lines.append(f"- `{relation}`: {count} fields")

    lines.extend(
        [
            "",
            "## Event Logging Threshold",
            "",
        ]
    )
    if stable_repeat is None:
        lines.append(f"- `{auth_mode}`: no stable repeat threshold found in the current matrix")
    else:
        lines.append(
            f"- `{auth_mode}`: stable minimum threshold is `RepeatCount={stable_repeat}` across the current delay matrix"
        )

    lines.extend(
        [
            "",
            "## Event Logging Probe Sensitivity",
            "",
        ]
    )
    for probe, threshold in probes.items():
        if threshold is None:
            lines.append(f"- `{probe}`: no direct event_logging hit observed")
        else:
            lines.append(f"- `{probe}`: first observed hit at `RepeatCount={threshold}`")

    lines.extend(
        [
            "",
            "## Source Inputs",
            "",
            f"- Control-plane logs: `{control_plane['direct_log']}` vs `{control_plane['gateway_log']}`",
            f"- Eval matrix label: `{eval_matrix['label']}`",
            f"- Event matrix rows: `{len(event_rows)}`",
            f"- Event probe rows: `{len(event_probe_rows)}`",
            "",
            "## Next Actions",
            "",
            "- When Claude Code updates, regenerate this report before changing rewrite logic.",
            "- If a change reproduces only in Docker, do not freeze it as an upstream transport fact until local npm shows the same behavior.",
            "- After confirming a real transport change, update packet-alignment-log, fingerprint-catalog, and transport-surface-map in the same slice.",
        ]
    )
    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Generate a single markdown maintenance report from current telemetry baselines."
    )
    parser.add_argument("--label", default=datetime.now().strftime("%Y-%m-%d"))
    parser.add_argument("--output", help="Optional markdown output path")
    parser.add_argument("--control-direct-log", default="mitm/dual-direct.log")
    parser.add_argument("--control-gateway-log", default="mitm/dual-gateway.log")
    parser.add_argument("--control-targets", default="mitm/control_plane_targets.json")
    parser.add_argument("--eval-targets", default="mitm/eval_attribute_targets.json")
    parser.add_argument("--eval-source", action="append", dest="eval_sources")
    parser.add_argument("--event-matrix", default="mitm/event_logging_matrix_2026-04-03.json")
    parser.add_argument("--event-probe-matrix", default="mitm/event_logging_probe_matrix_2026-04-03.json")
    args = parser.parse_args()

    control_plane = run_json_script(
        "summarize_control_plane_matrix.py",
        "--mode-label",
        args.label,
        "--direct-log",
        args.control_direct_log,
        "--gateway-log",
        args.control_gateway_log,
        "--targets",
        args.control_targets,
        "--format",
        "json",
    )

    eval_command = [
        "--label",
        args.label,
        "--targets",
        args.eval_targets,
        "--format",
        "json",
    ]
    for source in args.eval_sources or []:
        eval_command.extend(["--source", source])
    eval_matrix = run_json_script("summarize_eval_field_matrix.py", *eval_command)

    event_rows = load_json(Path(args.event_matrix))
    event_probe_rows = load_json(Path(args.event_probe_matrix))
    markdown = render_markdown(
        label=args.label,
        control_plane=control_plane,
        eval_matrix=eval_matrix,
        event_rows=event_rows,
        event_probe_rows=event_probe_rows,
    )

    if args.output:
        output_path = Path(args.output)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(markdown, encoding="utf-8")
    else:
        print(markdown, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
