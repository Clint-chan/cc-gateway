from __future__ import annotations

import argparse
import json
from datetime import datetime, UTC
from pathlib import Path

from mitmproxy import http
from mitmproxy.io import FlowReader


DEFAULT_SOURCES = [
    ("direct-subscriber", "mitm/direct.flows"),
    ("managed-oauth-via-gateway-side-channel", "mitm/dual-direct.flows"),
]


def read_targets(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def parse_source_spec(spec: str) -> tuple[str, Path]:
    if "=" not in spec:
        raise ValueError(f"invalid source spec {spec!r}; expected <label>=<flows-path>")
    label, raw_path = spec.split("=", 1)
    label = label.strip()
    raw_path = raw_path.strip()
    if not label or not raw_path:
        raise ValueError(f"invalid source spec {spec!r}; label and path must be non-empty")
    return label, Path(raw_path)


def read_eval_payloads(path: Path) -> tuple[list[dict], list[str]]:
    payloads: list[dict] = []
    urls: list[str] = []
    with path.open("rb") as handle:
        reader = FlowReader(handle)
        for flow in reader.stream():
            if not isinstance(flow, http.HTTPFlow):
                continue
            if "/api/eval/" not in flow.request.pretty_url:
                continue
            try:
                payload = json.loads(flow.request.get_text(strict=False))
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            payloads.append(payload)
            urls.append(flow.request.pretty_url)
    return payloads, urls


def extract_path(payload: dict, dotted_path: str):
    current = payload
    for part in dotted_path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return current


def serialize_value(value) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def dedupe_values(values: list) -> list:
    seen: dict[str, object] = {}
    for value in values:
        key = serialize_value(value)
        if key not in seen:
            seen[key] = value
    return list(seen.values())


def stability_label(distinct_values: list) -> str:
    if not distinct_values:
        return "absent"
    if len(distinct_values) == 1:
        return "stable"
    return "variable"


def relation_label(left_values: list, right_values: list) -> str:
    if not left_values and not right_values:
        return "both-absent"
    if left_values and not right_values:
        return "absent-in-right"
    if right_values and not left_values:
        return "absent-in-left"
    left_keys = {serialize_value(value) for value in left_values}
    right_keys = {serialize_value(value) for value in right_values}
    if left_keys == right_keys:
        return "same"
    return "different"


def build_rows(targets: list[dict], source_payloads: dict[str, dict]) -> list[dict]:
    source_labels = list(source_payloads.keys())
    rows: list[dict] = []
    for target in targets:
        per_source: dict[str, dict] = {}
        for label in source_labels:
            payloads = source_payloads[label]["payloads"]
            observed = []
            for payload in payloads:
                value = extract_path(payload, target["path"])
                if value is not None:
                    observed.append(value)
            distinct_values = dedupe_values(observed)
            per_source[label] = {
                "present_count": len(observed),
                "request_count": len(payloads),
                "distinct_values": distinct_values,
                "stability": stability_label(distinct_values),
            }

        relations = {}
        if len(source_labels) >= 2:
            base_label = source_labels[0]
            for other_label in source_labels[1:]:
                relations[f"{base_label}__vs__{other_label}"] = relation_label(
                    per_source[base_label]["distinct_values"],
                    per_source[other_label]["distinct_values"],
                )

        rows.append(
            {
                "path": target["path"],
                "group": target["group"],
                "expected_relation": target["expected_relation"],
                "notes": target["notes"],
                "sources": per_source,
                "relations": relations,
            }
        )
    return rows


def format_value_list(values: list) -> str:
    if not values:
        return "absent"
    if len(values) == 1:
        return serialize_value(values[0])
    rendered = ", ".join(serialize_value(value) for value in values[:2])
    if len(values) > 2:
        rendered += ", ..."
    return rendered


def render_markdown(result: dict) -> str:
    source_labels = [source["label"] for source in result["sources"]]
    header = [
        f"# Eval Field Matrix Summary: {result['label']}",
        "",
        "| Field | Group | " + " | ".join(source_labels) + " | Expected | Relation | Notes |",
        "| --- | --- | " + " | ".join("---" for _ in source_labels) + " | --- | --- | --- |",
    ]
    for row in result["rows"]:
        relation = "-"
        if row["relations"]:
            relation = "; ".join(
                f"{name}={value}" for name, value in row["relations"].items()
            )
        source_cells = []
        for label in source_labels:
            source = row["sources"][label]
            source_cells.append(
                f"{source['stability']}: {format_value_list(source['distinct_values'])}"
            )
        header.append(
            "| {path} | {group} | {sources} | {expected} | {relation} | {notes} |".format(
                path=row["path"],
                group=row["group"],
                sources=" | ".join(source_cells),
                expected=row["expected_relation"],
                relation=relation,
                notes=row["notes"],
            )
        )
    return "\n".join(header)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Summarize /api/eval/* request fields across one or more MITM capture baselines."
    )
    parser.add_argument(
        "--source",
        action="append",
        dest="sources",
        help="Source in the form <label>=<flows-path>. Repeat to compare multiple baselines.",
    )
    parser.add_argument("--targets", default="mitm/eval_attribute_targets.json")
    parser.add_argument("--label", default="current-baseline")
    parser.add_argument("--format", choices=("json", "markdown"), default="json")
    args = parser.parse_args()

    source_specs = args.sources or [
        f"{label}={path}" for label, path in DEFAULT_SOURCES
    ]
    parsed_sources = [parse_source_spec(spec) for spec in source_specs]
    source_payloads: dict[str, dict] = {}
    sources_summary = []
    for label, path in parsed_sources:
        payloads, urls = read_eval_payloads(path)
        source_payloads[label] = {"payloads": payloads, "urls": urls, "path": path}
        sources_summary.append(
            {
                "label": label,
                "flows_path": str(path),
                "eval_request_count": len(payloads),
                "sample_urls": dedupe_values(urls)[:5],
            }
        )

    result = {
        "generated_at": datetime.now(UTC).isoformat(),
        "label": args.label,
        "targets_path": args.targets,
        "sources": sources_summary,
        "rows": build_rows(read_targets(Path(args.targets)), source_payloads),
    }

    if args.format == "markdown":
        print(render_markdown(result))
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
