# CC Gateway Operations

## Purpose

This document records the current operational workflow for the existing gateway implementation.

It is intentionally practical:

- what is needed before startup
- how to run locally with Docker
- which credentials must be filled in
- how to verify the container is working
- what to watch during future updates

## Current Runtime Shape

The current implementation is a single backend gateway process with:

- one `config.yaml`
- one canonical identity
- one managed OAuth refresh token
- one or more client bearer tokens
- optional HTTPS via mounted certificate files

There is no admin UI yet. All operational changes are currently file-based.

## Required Inputs

Before the gateway can work against the real upstream, prepare:

1. one Claude account that can provide a valid Claude Code OAuth `refresh_token`
2. one canonical `device_id`
3. one canonical account email
4. at least one client bearer token for gateway access
5. TLS certificate and key for HTTPS

## Local Files

The current local deployment uses:

- [config.yaml](/C:/Users/94503/Documents/GitHub/cc-gateway/config.yaml)
- [docker-compose.yml](/C:/Users/94503/Documents/GitHub/cc-gateway/docker-compose.yml)
- [Dockerfile](/C:/Users/94503/Documents/GitHub/cc-gateway/Dockerfile)
- [cert.pem](/C:/Users/94503/Documents/GitHub/cc-gateway/certs/cert.pem)
- [key.pem](/C:/Users/94503/Documents/GitHub/cc-gateway/certs/key.pem)
- [mitm/README.md](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/README.md)
- [mitm/capture.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/capture.py)

## Credentials To Replace

Before real use, replace these fields in [config.yaml](/C:/Users/94503/Documents/GitHub/cc-gateway/config.yaml):

- `oauth.refresh_token`
- `identity.email`

Review these values as well and adjust if needed:

- `network.proxy_url`
- `identity.device_id`
- `auth.tokens`
- `env.*`
- `prompt_env.*`
- `process.*`
- `logging.file`
- `logging.audit_file`

## Local Docker Deployment

### 1. Build the image

```powershell
.\scripts\inspect-docker-proxy-path.ps1
docker compose build
```

If the build fails while pulling `node:22-slim`, the issue is network access to Docker Hub, not the repository itself.

Current Windows-specific rule:

- Docker Desktop daemon proxy and container runtime proxy are two different paths
- runtime containers can use `host.docker.internal` if Compose adds `host-gateway`
- the Docker daemon still needs a proxy endpoint that is reachable from the Docker VM itself

If your local proxy only listens on Windows loopback, the runtime path can still be fixed in-repo, but image pulls may continue to fail until Docker Desktop can reach that proxy.

### 2. Start the service

```powershell
docker compose up -d
```

If the upstream must be reached through a local or remote proxy, prefer setting it in [config.yaml](/C:/Users/94503/Documents/GitHub/cc-gateway/config.yaml):

```yaml
network:
  proxy_url: http://host.docker.internal:10808
```

For Docker Desktop, `host.docker.internal` is the correct runtime-side host alias.  
`127.0.0.1` inside the container points back to the container itself, not to the Windows host.

The repository Compose file now also includes:

- `extra_hosts: host.docker.internal:host-gateway`
- `./runtime:/app/runtime`

This gives the container a stable host alias and persists file logs outside the container.

### 3. Inspect logs

```powershell
docker compose logs -f gateway
```

If you enable file logging, runtime logs are written under:

- `runtime/logs/gateway.log`
- `runtime/logs/audit.log`

Expected startup flow:

- config loads successfully
- OAuth refresh is attempted
- proxy starts listening on port `8443`

If `oauth.refresh_token` is still a placeholder, startup or health will fail. That is expected until real credentials are added.

## Verification

### Health check

```powershell
curl https://localhost:8443/_health --insecure
```

Expected behavior:

- `200` when OAuth token is valid
- `503` when OAuth is missing, expired, or refresh is failing

### Rewrite preview

Use the current client token from [config.yaml](/C:/Users/94503/Documents/GitHub/cc-gateway/config.yaml):

```powershell
curl https://localhost:8443/_verify `
  -H "Authorization: Bearer ea8bb4e71d365b9d7b53c747696c0d1f52ffdb961ecd974fd36d6887d0121713" `
  --insecure
```

Expected behavior:

- returns a sample before/after payload
- confirms how `device_id`, prompt environment text, and billing header are rewritten

## Local Proxy Requirements

For this Windows workstation, local debugging only works reliably when the spawned process explicitly inherits the local proxy settings.

Use these values:

```powershell
$env:HTTP_PROXY='http://127.0.0.1:10808'
$env:HTTPS_PROXY='http://127.0.0.1:10808'
$env:ALL_PROXY='http://127.0.0.1:10808'
```

Observed pitfall:

- user-interactive PowerShell sessions could reach Claude successfully
- separately spawned `claude` or `node` processes from tooling returned `403 Request not allowed`
- the difference was that the tool-spawned processes were not inheriting the `10808` proxy chain unless set explicitly

Operational rule:

- whenever testing `claude -p`, OAuth refresh, or gateway upstream calls from automation, always inject the proxy environment variables in the same command or process launcher
- for long-term deployment, prefer `network.proxy_url` in config over ad hoc process launch injection
- for Docker, use a container-reachable proxy host such as `host.docker.internal`, not host loopback

## MITM Capture Workflow

MITM artifacts must stay under [mitm](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm).

Current files:

- [capture.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/capture.py): mitmdump addon for header/body capture
- [claude-cli.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.flows): raw flow dump from CLI capture
- [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log): parsed request log
- [direct-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct-debug.txt): successful direct CLI debug log
- [via-gateway-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/via-gateway-debug.txt): failed gateway attempt using `Proxy-Authorization`

Recommended workflow:

1. Start `mitmdump` on a dedicated local port such as `18080`
2. Set `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` to that MITM port for the process being tested
3. Set `NODE_EXTRA_CA_CERTS` to `C:\Users\94503\.mitmproxy\mitmproxy-ca-cert.pem`
4. Capture to a `.flows` file first, then parse that file into a human-readable `.log`

Why `.flows` first:

- Windows `Start-Process` log redirection was unreliable for this workflow
- raw mitm flow dumps were stable and could be parsed afterwards without losing requests

Captured CLI request shape to Anthropic currently includes:

- `Authorization: Bearer <oauth access token>`
- `anthropic-beta: ... ,oauth-2025-04-20,...`
- `x-app: cli`
- `X-Claude-Code-Session-Id`
- `/v1/messages?beta=true`

This capture should be treated as the reference shape when aligning gateway upstream headers.

## Client Configuration

Each Claude Code client should set:

```bash
export ANTHROPIC_BASE_URL="https://your-gateway-host:8443"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
export CLAUDE_CODE_OAUTH_TOKEN="gateway-managed"
export ANTHROPIC_CUSTOM_HEADERS="x-api-key: YOUR_CLIENT_TOKEN"
```

Effect:

- Claude Code sends traffic to the gateway
- nonessential side-channel traffic is reduced
- browser OAuth is skipped on the client
- the gateway authenticates the client token and injects the real upstream OAuth token

This is the recommended `quiet mode` for actual users.
If you are doing telemetry alignment instead of end-user access, switch to [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md) and remove `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`.

### Recommended tester distribution format

For testers, prefer distributing a `.claude.json` file instead of asking them to export variables manually.

Example:

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

Reference:

- [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)
- [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)

Operational note:

- this format is useful for one-click tester onboarding
- `ANTHROPIC_AUTH_TOKEN` maps naturally to the gateway's bearer-token client auth path
- this is distinct from the gateway's upstream OAuth token, which remains server-managed

Important Windows note:

- when Claude Code is already using a local HTTP proxy such as `127.0.0.1:10808`, do not use `Proxy-Authorization` inside `ANTHROPIC_CUSTOM_HEADERS`
- Claude Code's internal proxy agent rejects that header with `UND_ERR_INVALID_ARG`
- use `x-api-key` for gateway auth instead

## Operational Notes

### TLS

The current local certificate is self-signed and only suitable for local testing.

For real use:

- replace it with a proper certificate
- avoid exposing plain HTTP

## Docker Backfill Findings

Current Docker verification produced two separate findings:

1. Container runtime path

- with `host.docker.internal:host-gateway`, a probe container can reach `host.docker.internal:10808`
- this means the gateway runtime inside Docker can use:
  `network.proxy_url: http://host.docker.internal:10808`

2. Docker daemon build path

- `docker compose build` still depends on Docker Desktop daemon proxy reachability during base-image pulls
- if Docker Desktop itself cannot reach the configured proxy, repository changes alone cannot fix `node:22-slim` pulls

Operationally, this means:

- runtime parity is now documented and encoded in Compose
- image-pull failures should be triaged as Docker Desktop/network prerequisites, not as gateway code regressions

### Secrets

Current secret handling is still minimal because the project is in proof-of-concept form.

Current risks:

- `refresh_token` is stored in plain text in `config.yaml`
- client bearer tokens are also stored in `config.yaml`

Future control plane work should move these into encrypted persistent storage.

### Network Dependencies

Current Docker deployment depends on:

- Docker being able to pull base images from Docker Hub
- the gateway being able to reach `api.anthropic.com`
- the gateway being able to reach `platform.claude.com` for OAuth refresh
- if a proxy is required, the containerized runtime must also be able to reach the configured `network.proxy_url`

### Docker Direction

Docker remains a target deployment mode and should be kept aligned with local runtime behavior.

When updating Docker support, preserve these invariants:

- `config.yaml` remains the primary source for upstream proxy routing
- container startup should not depend on hidden Docker Desktop proxy state
- client auth to the gateway should continue using `x-api-key`
- local self-signed TLS instructions must remain documented for local-only tests

### Side-Channel Blocking

The gateway alone is not the full network control boundary.

For stricter enforcement later:

- add Clash or firewall rules
- block direct access to Anthropic-related domains from clients
- review MCP-related bypasses separately

## Update Checklist

Whenever the runtime changes, review this document if any of these changed:

- startup commands
- mounted files
- config structure
- health endpoint behavior
- token acquisition flow
- TLS behavior
- Docker image requirements

If one of those changes, update this document in the same PR.
