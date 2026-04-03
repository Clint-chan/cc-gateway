from mitmproxy import http
import json
import re


SENSITIVE_HEADERS = {"authorization", "x-api-key", "cookie"}


def _mask(value: str) -> str:
    if len(value) <= 24:
        return value
    return value[:18] + "..." + value[-6:]


def request(flow: http.HTTPFlow) -> None:
    if "anthropic.com" not in flow.request.pretty_host:
        return

    print(f"REQ {flow.request.method} {flow.request.pretty_url}", flush=True)
    for key, value in flow.request.headers.items():
        if key.lower() in SENSITIVE_HEADERS:
            value = _mask(value)
        print(f"H {key}: {value}", flush=True)

    body = flow.request.get_text(strict=False)
    if body:
        print("BODY " + body[:1200], flush=True)
        _print_body_signals(flow.request.path, body)
    print("---", flush=True)


def response(flow: http.HTTPFlow) -> None:
    if "anthropic.com" not in flow.request.pretty_host:
        return

    print(f"RES {flow.response.status_code} {flow.request.pretty_url}", flush=True)
    print("---END---", flush=True)


def _print_body_signals(path: str, body: str) -> None:
    try:
        payload = json.loads(body)
    except Exception:
        payload = None

    if path.startswith("/v1/messages") and isinstance(payload, dict):
        metadata = payload.get("metadata") or {}
        user_id = metadata.get("user_id")
        if user_id:
            print(f"SIGNAL metadata.user_id={user_id}", flush=True)

        cc_header = _find_cc_billing_header(payload)
        if cc_header:
            print(f"SIGNAL billing_header={cc_header}", flush=True)

    if "/api/eval/" in path and isinstance(payload, dict):
        attrs = payload.get("attributes") or {}
        if attrs:
            print("SIGNAL eval.attributes=" + json.dumps(attrs, ensure_ascii=False), flush=True)

    if "/event_logging/" in path and isinstance(payload, dict):
        events = payload.get("events") or []
        if events:
            event_data = (events[0] or {}).get("event_data") or {}
            core = {
                "device_id": event_data.get("device_id"),
                "email": event_data.get("email"),
                "entrypoint": event_data.get("entrypoint"),
                "client_type": event_data.get("client_type"),
                "env": event_data.get("env"),
            }
            print("SIGNAL event.core=" + json.dumps(core, ensure_ascii=False), flush=True)


def _find_cc_billing_header(payload: dict) -> str | None:
    blocks = []

    system = payload.get("system")
    if isinstance(system, list):
        blocks.extend(system)
    elif system is not None:
        blocks.append(system)

    messages = payload.get("messages")
    if isinstance(messages, list):
        for msg in messages:
            content = msg.get("content") if isinstance(msg, dict) else None
            if isinstance(content, list):
                blocks.extend(content)
            elif content is not None:
                blocks.append(content)

    for block in blocks:
        text = None
        if isinstance(block, dict):
            text = block.get("text")
        elif isinstance(block, str):
            text = block
        if not isinstance(text, str):
            continue
        match = re.search(r"x-anthropic-billing-header:[^\n<]+", text)
        if match:
            return match.group(0)
    return None
