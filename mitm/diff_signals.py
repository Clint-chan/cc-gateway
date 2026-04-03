from __future__ import annotations

import json
import sys
from pathlib import Path

from extract_signals import read_flows, extract_signal_summary


def latest_summary(path: Path, url_filter: str | None = None) -> dict:
    flows = read_flows(path)
    if url_filter:
        flows = [flow for flow in flows if url_filter in flow.request.pretty_url]
    if not flows:
        return {}
    return extract_signal_summary(flows[-1])


def main() -> int:
    if len(sys.argv) not in (3, 4):
        print(
            "usage: python mitm/diff_signals.py <direct.flows> <gateway.flows> [url-substring]",
            file=sys.stderr,
        )
        return 1

    url_filter = sys.argv[3] if len(sys.argv) == 4 else None

    left = latest_summary(Path(sys.argv[1]), url_filter)
    right = latest_summary(Path(sys.argv[2]), url_filter)
    keys = sorted(set(left.keys()) | set(right.keys()))

    diff = []
    for key in keys:
        lv = left.get(key)
        rv = right.get(key)
        if lv != rv:
            diff.append({
                "field": key,
                "direct": lv,
                "gateway": rv,
            })

    print(json.dumps({
        "direct_file": sys.argv[1],
        "gateway_file": sys.argv[2],
        "url_filter": url_filter,
        "differences": diff,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
