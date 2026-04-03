MITM capture assets and logs for local Claude Code / gateway traffic debugging.

## Purpose

This directory stores:

- raw MITM flow files
- parsed request logs
- direct Claude Code debug logs
- notes about what each capture proved

Keep all temporary capture artifacts here so auth/proxy debugging remains reproducible.

## Files

- `capture.py`: mitmdump addon for request/response capture
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

1. Keep the workstation proxy on `127.0.0.1:10808`
2. Run direct CLI with:
   - `HTTP_PROXY`
   - `HTTPS_PROXY`
   - `ALL_PROXY`
3. For gateway tests, use:
   - `ANTHROPIC_BASE_URL=https://localhost:8443`
   - `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
   - `ANTHROPIC_CUSTOM_HEADERS=x-api-key: <token>`
4. If MITM is needed again, capture to `.flows` first and parse afterwards
