# CC Gateway Auth/Proxy Debugging

## Purpose

This document records the full debugging path that led to a working local gateway setup on Windows.

The goal is to preserve:

- the actual failure modes we observed
- the wrong assumptions that caused wasted time
- the final known-good client and gateway configuration
- the reference artifacts under [mitm](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm)

## Final Working Local Setup

### Client side

The local Claude Code client worked with these environment variables:

```powershell
$env:HTTP_PROXY='http://127.0.0.1:10808'
$env:HTTPS_PROXY='http://127.0.0.1:10808'
$env:ALL_PROXY='http://127.0.0.1:10808'
$env:ANTHROPIC_BASE_URL='https://localhost:8443'
$env:CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC='1'
$env:CLAUDE_CODE_OAUTH_TOKEN='gateway-managed'
$env:ANTHROPIC_CUSTOM_HEADERS='x-api-key: YOUR_CLIENT_TOKEN'
$env:NODE_TLS_REJECT_UNAUTHORIZED='0'
```

This is the known-good `quiet mode` for local gateway usage.
It is correct for operator and tester onboarding, but it is not suitable for telemetry alignment captures because it suppresses nonessential traffic by design.

For tester distribution, a `.claude.json` file is the cleaner path:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "ANTHROPIC_AUTH_TOKEN": "your-gateway-client-token",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "hasCompletedOnboarding": true
}
```

This avoids making testers type shell-specific environment commands.

For telemetry alignment work, use [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md) and switch to `alignment mode`.

### Gateway side

The gateway now supports a dedicated proxy configuration in [config.yaml](/C:/Users/94503/Documents/GitHub/cc-gateway/config.yaml):

```yaml
network:
  proxy_url: http://127.0.0.1:10808
```

This proxy setting is used for:

- upstream `api.anthropic.com` requests
- OAuth refresh requests to `platform.claude.com`

Environment variables remain as fallback, but the preferred future path is explicit config.

## Failure Modes Observed

### 1. Direct CLI worked in user PowerShell, but failed from automation

Observed behavior:

- user manually ran `claude -p "hello"` and got a normal response
- automation-launched `claude -p "hello"` returned `403 Request not allowed`

Root cause:

- spawned processes did not inherit the local `10808` proxy chain

Resolution:

- explicitly inject `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` for automated process launches

### 2. Gateway health was green, but upstream calls still failed

Observed behavior:

- `/_health` showed `oauth: valid`
- proxied `/v1/messages` still returned `403`

Root cause:

- the gateway used Node's native `https.request`
- native `https.request` does not automatically honor `HTTP_PROXY` / `HTTPS_PROXY`
- the gateway looked healthy locally but was still trying to reach upstream directly

Resolution:

- add explicit proxy-agent support in code
- add `network.proxy_url` to config

### 3. README client auth guidance caused client-side connection failures

Original README guidance used:

```bash
ANTHROPIC_CUSTOM_HEADERS="Proxy-Authorization: Bearer YOUR_TOKEN"
```

Observed behavior on Windows with a local proxy:

- Claude Code retried repeatedly
- debug logs ended with:
  - `UND_ERR_INVALID_ARG`
  - `Proxy-Authorization should be sent in ProxyAgent constructor`

Root cause:

- Claude Code's own internal proxy agent treats `Proxy-Authorization` as a reserved proxy-level header
- combining a local proxy and `ANTHROPIC_CUSTOM_HEADERS=Proxy-Authorization: ...` breaks the client before the request reaches the gateway

Resolution:

- use `x-api-key` for gateway client auth
- keep proxy credentials separate from gateway auth

## Reference Debug Artifacts

Important files:

- [direct-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct-debug.txt)
- [via-gateway-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/via-gateway-debug.txt)
- [claude-cli.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.flows)
- [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)

These files showed:

- direct first-party CLI requests used `Authorization: Bearer ...`
- `/v1/messages` was sent to `/v1/messages?beta=true`
- `anthropic-beta` included `oauth-2025-04-20`
- client-side gateway auth must not use `Proxy-Authorization` in this environment

## Gateway Header Alignment Notes

The current gateway implementation was updated to align better with the captured CLI shape:

- inject upstream `Authorization: Bearer <oauth access token>`
- ensure `oauth-2025-04-20` is present in `anthropic-beta`
- set `x-app: cli` if absent
- normalize `/v1/messages` to include `?beta=true`

These changes came from the captured direct CLI reference in [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log).

## Docker Follow-Up

This project should keep Docker as a first-class deployment target.

When Docker work resumes, verify these explicitly:

1. container can resolve and reach the configured proxy endpoint
2. `config.yaml` is mounted with `network.proxy_url`
3. startup logs confirm OAuth is valid under container networking
4. client requests through the container still use `x-api-key` auth
5. if self-signed TLS is used for local Docker tests, client certificate trust behavior is documented

Recommended next Docker step:

- update `docker-compose.yml` and docs so `config.yaml` remains the single source of truth for proxy routing
- avoid relying on ad hoc Docker Desktop proxy settings alone
