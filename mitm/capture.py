from mitmproxy import http


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
    print("---", flush=True)


def response(flow: http.HTTPFlow) -> None:
    if "anthropic.com" not in flow.request.pretty_host:
        return

    print(f"RES {flow.response.status_code} {flow.request.pretty_url}", flush=True)
    print("---END---", flush=True)
