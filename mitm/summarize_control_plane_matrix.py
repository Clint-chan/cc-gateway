from __future__ import annotations

import argparse
import json
from pathlib import Path


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def count_hits(text: str, pattern: str) -> int:
    return sum(1 for line in text.splitlines() if pattern in line)


def owner_from_counts(direct_count: int, gateway_count: int) -> str:
    if direct_count and gateway_count:
        return "mixed-surface"
    if direct_count:
        return "direct-host-side-channel"
    if gateway_count:
        return "gateway-mainline"
    return "not-observed"


def present_label(count: int) -> str:
    if count:
        return f"yes ({count})"
    return "no"


def load_targets(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def build_rows(targets: list[dict], direct_text: str, gateway_text: str) -> list[dict]:
    rows = []
    for target in targets:
        direct_count = count_hits(direct_text, target["pattern"])
        gateway_count = count_hits(gateway_text, target["pattern"])
        inferred_owner = owner_from_counts(direct_count, gateway_count)
        rows.append(
            {
                "key": target["key"],
                "surface": target["surface"],
                "pattern": target["pattern"],
                "direct_count": direct_count,
                "gateway_count": gateway_count,
                "direct_present": bool(direct_count),
                "gateway_present": bool(gateway_count),
                "inferred_owner": inferred_owner,
                "expected_owner": target["expected_owner"],
                "owner_matches_expectation": inferred_owner == target["expected_owner"]
                or inferred_owner == "not-observed",
                "notes": target["notes"],
            }
        )
    return rows


def render_markdown(mode_label: str, rows: list[dict]) -> str:
    lines = [
        f"# Control-Plane Matrix Summary: {mode_label}",
        "",
        "| Surface | Direct | Gateway Upstream | Inferred Owner | Expected Owner | Notes |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        lines.append(
            "| {surface} | {direct} | {gateway} | {owner} | {expected} | {notes} |".format(
                surface=row["surface"],
                direct=present_label(row["direct_count"]),
                gateway=present_label(row["gateway_count"]),
                owner=row["inferred_owner"],
                expected=row["expected_owner"],
                notes=row["notes"],
            )
        )
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize trusted via-gateway control-plane captures into a reusable matrix."
    )
    parser.add_argument("--mode-label", default="current-capture")
    parser.add_argument("--direct-log", default="mitm/dual-direct.log")
    parser.add_argument("--gateway-log", default="mitm/dual-gateway.log")
    parser.add_argument("--targets", default="mitm/control_plane_targets.json")
    parser.add_argument("--format", choices=("markdown", "json"), default="markdown")
    args = parser.parse_args()

    direct_log = Path(args.direct_log)
    gateway_log = Path(args.gateway_log)
    targets_path = Path(args.targets)

    direct_text = read_text(direct_log)
    gateway_text = read_text(gateway_log)
    targets = load_targets(targets_path)
    rows = build_rows(targets, direct_text, gateway_text)

    if args.format == "json":
        print(
            json.dumps(
                {
                    "mode_label": args.mode_label,
                    "direct_log": str(direct_log),
                    "gateway_log": str(gateway_log),
                    "rows": rows,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(render_markdown(args.mode_label, rows))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
