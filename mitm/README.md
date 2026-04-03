MITM capture assets and logs for local Claude Code / gateway traffic debugging.

## Purpose

This directory stores:

- raw MITM flow files
- parsed request logs
- direct Claude Code debug logs
- notes about what each capture proved

Keep all temporary capture artifacts here so auth/proxy debugging remains reproducible.

Every time a capture leads to a concrete alignment fix, also append the conclusion to:

- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

## Files

- `capture.py`: mitmdump addon for request/response capture
- `extract_signals.py`: extract the latest request's key fingerprint signals from a `.flows` file
- `diff_signals.py`: compare the latest key signals from direct and gateway captures
- `claude-cli.flows`: direct Claude CLI flow dump
- `claude-cli.log`: parsed direct Claude CLI request log
- `direct-debug.txt`: direct `claude -p "hello"` success log
- `via-gateway-debug.txt`: gateway attempt log showing the `Proxy-Authorization` client-side failure
- `gateway.flows`: reserved for future gateway upstream captures
- `gateway.log`: reserved for future parsed gateway upstream captures

## Key Findings

### Direct Claude CLI request shape

From `claude-cli.log`:

- upstream auth uses `Authorization: Bearer <oauth access token>`
- `/v1/messages` is sent to `/v1/messages?beta=true`
- `anthropic-beta` includes `oauth-2025-04-20`
- the request also includes Claude-specific headers such as:
  - `x-app: cli`
  - `X-Claude-Code-Session-Id`
  - `x-client-request-id`

### Client auth pitfall when using a local proxy

From `via-gateway-debug.txt`:

- using `ANTHROPIC_CUSTOM_HEADERS="Proxy-Authorization: Bearer ..."` caused client-side failures
- Claude Code retried and finally reported:
  - `UND_ERR_INVALID_ARG`
  - `Proxy-Authorization should be sent in ProxyAgent constructor`

This means:

- `Proxy-Authorization` must not be reused for gateway auth in this local proxy setup
- `x-api-key` is the correct client auth header for the gateway

## Current Recommended Test Pattern

### quiet mode

1. Keep the workstation proxy on `127.0.0.1:10808`
2. Run gateway tests with:
   - `ANTHROPIC_BASE_URL=https://localhost:8443`
   - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
   - `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
   - `ANTHROPIC_CUSTOM_HEADERS=x-api-key: <token>`

This mode is good for actual client usage, but it intentionally suppresses telemetry side channels.

### alignment mode

1. Keep the workstation proxy on `127.0.0.1:10808`
2. Run direct CLI with:
   - `HTTP_PROXY`
   - `HTTPS_PROXY`
   - `ALL_PROXY`
3. Do not set `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
4. For gateway tests, use:
   - `ANTHROPIC_BASE_URL=https://localhost:8443`
   - `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
   - `ANTHROPIC_CUSTOM_HEADERS=x-api-key: <token>`
5. If MITM is needed again, capture to `.flows` first and parse afterwards

This mode is the only one suitable for validating `/api/eval/*` and `/api/event_logging/*`.

## Useful Commands

Extract the latest captured gateway request signals:

```powershell
python mitm/extract_signals.py mitm/gateway.flows
```

Extract the latest three captured requests:

```powershell
python mitm/extract_signals.py mitm/gateway.flows 3
```

Compare the latest direct and gateway signals:

```powershell
python mitm/diff_signals.py mitm/claude-cli.flows mitm/gateway.flows
```

Compare the latest `/v1/messages` request specifically:

```powershell
python mitm/diff_signals.py mitm/claude-cli.flows mitm/gateway.flows /v1/messages
```

Start a fresh direct capture session:

```powershell
.\scripts\capture-direct.ps1
```

Finalize a direct capture and print the latest signals:

```powershell
.\scripts\finalize-direct-capture.ps1
```
