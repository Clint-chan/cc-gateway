from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from mitmproxy.io import FlowReader


def read_flows(path: Path):
    with path.open("rb") as f:
        return list(FlowReader(f).stream())


def get_header(flow, name: str) -> str | None:
    for key, value in flow.request.headers.items():
      if key.lower() == name.lower():
        return value
    return None


def find_billing_headers(body: str) -> list[str]:
    pattern = (
        r"x-anthropic-billing-header:\s*"
        r"cc_version=[^;]+;\s*"
        r"cc_entrypoint=[^;]+;\s*"
        r"(?:cch=[^;]+;\s*)?"
    )
    return re.findall(pattern, body)


def extract_signal_summary(flow) -> dict:
    body = flow.request.get_text(strict=False)
    anthropic_beta = get_header(flow, "anthropic-beta")
    if anthropic_beta:
        anthropic_beta = ",".join(sorted(part.strip() for part in anthropic_beta.split(",") if part.strip()))

    summary: dict[str, object] = {
        "method": flow.request.method,
        "url": flow.request.pretty_url,
        "user_agent": get_header(flow, "user-agent"),
        "anthropic_beta": anthropic_beta,
        "x_app": get_header(flow, "x-app"),
    }

    try:
        payload = json.loads(body)
    except Exception:
        payload = None

    if isinstance(payload, dict):
        metadata = payload.get("metadata")
        if isinstance(metadata, dict):
            summary["metadata.user_id"] = metadata.get("user_id")

        headers = find_billing_headers(body)
        if headers:
            summary["billing_headers"] = headers

        attrs = payload.get("attributes")
        if isinstance(attrs, dict):
            summary["eval.attributes"] = attrs

        events = payload.get("events")
        if isinstance(events, list) and events:
            event_data = events[0].get("event_data") if isinstance(events[0], dict) else None
            if isinstance(event_data, dict):
                summary["event.entrypoint"] = event_data.get("entrypoint")
                summary["event.client_type"] = event_data.get("client_type")
                summary["event.device_id"] = event_data.get("device_id")
                summary["event.email"] = event_data.get("email")
                summary["event.env"] = event_data.get("env")

    return summary


def main() -> int:
    if len(sys.argv) < 2 or len(sys.argv) > 4:
        print(
            "usage: python mitm/extract_signals.py <flows-file> [last-n] [url-substring]",
            file=sys.stderr,
        )
        return 1

    path = Path(sys.argv[1])
    last_n = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    url_filter = sys.argv[3] if len(sys.argv) > 3 else None
    flows = read_flows(path)
    if url_filter:
        flows = [flow for flow in flows if url_filter in flow.request.pretty_url]
    if not flows:
        print("[]")
        return 0

    result = [extract_signal_summary(flow) for flow in flows[-last_n:]]
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
