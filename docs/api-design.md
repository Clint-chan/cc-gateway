# CC Gateway Fork API Design

## Purpose

This document outlines the management API for the forked `cc-gateway` platform.

The API described here is the control plane API, not the Claude Code reverse proxy endpoint. Its purpose is to let operators manage:

- Claude accounts
- fingerprint profiles
- proxy nodes
- client machines
- routing policies
- health and audit data

The reverse proxy data path should remain separate from the admin API.

## API Scope

Two API surfaces will exist in the long-term design:

1. Gateway data plane API
   Used by Claude Code clients for proxied traffic.
2. Management control plane API
   Used by the admin UI and operators.

This document focuses only on the management control plane API.

## Design Principles

- Keep resources explicit and predictable.
- Use stable IDs in all references.
- Return redacted secrets by default.
- Make operational status observable.
- Design for incremental implementation.

## Base Path

Recommended base path:

```text
/api/admin/v1
```

## Authentication

The admin API should not reuse gateway client bearer tokens.

Recommended admin authentication path:

- operator login session or JWT for the web UI
- later support for SSO or external identity provider

Minimum requirement:

- all admin endpoints require authenticated operator identity
- all mutating endpoints require an audit trail

## Response Conventions

### Success Envelope

```json
{
  "data": {},
  "meta": {}
}
```

### Error Envelope

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Fingerprint profile is inconsistent",
    "details": {}
  }
}
```

### Pagination

For list endpoints:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "pageSize": 20,
    "total": 120
  }
}
```

## Resource Groups

The initial admin API should expose these groups:

1. auth
2. accounts
3. fingerprints
4. proxies
5. clients
6. policies
7. sessions
8. audit
9. health
10. dashboard

## Auth Endpoints

### `POST /api/admin/v1/auth/login`

Purpose:

- authenticate an operator

Request:

```json
{
  "username": "admin",
  "password": "secret"
}
```

Response:

```json
{
  "data": {
    "token": "jwt-or-session-token",
    "user": {
      "id": "op_123",
      "username": "admin",
      "role": "SUPER_ADMIN"
    }
  }
}
```

### `POST /api/admin/v1/auth/logout`

Purpose:

- invalidate current operator session

### `GET /api/admin/v1/auth/me`

Purpose:

- return current operator profile

## Account Endpoints

### `GET /api/admin/v1/accounts`

Purpose:

- list Claude accounts with filtering

Query examples:

- `status=ACTIVE`
- `tag=team-a`
- `regionHint=us-west`

Response item shape:

```json
{
  "id": "acct_123",
  "name": "claude-main-01",
  "status": "ACTIVE",
  "email": "masked@example.com",
  "deviceId": "f3b1...redacted",
  "fingerprintProfileId": "fp_123",
  "defaultProxyId": "px_123",
  "quotaState": "NORMAL",
  "lastRefreshAt": "2026-04-03T08:00:00Z",
  "lastRefreshError": null,
  "tags": ["team-a", "west"]
}
```

### `POST /api/admin/v1/accounts`

Purpose:

- create a Claude account record

Request:

```json
{
  "name": "claude-main-01",
  "email": "user@example.com",
  "deviceId": "64-char-hex",
  "refreshToken": "raw-refresh-token",
  "fingerprintProfileId": "fp_123",
  "defaultProxyId": "px_123",
  "tags": ["team-a"]
}
```

Behavior:

- encrypt and store `refreshToken`
- validate referenced fingerprint and proxy
- create audit log

### `GET /api/admin/v1/accounts/:id`

Purpose:

- fetch one account detail

### `PATCH /api/admin/v1/accounts/:id`

Purpose:

- update account metadata and bindings

Patchable fields:

- `name`
- `status`
- `email`
- `deviceId`
- `fingerprintProfileId`
- `defaultProxyId`
- `tags`
- `notes`
- `concurrencyLimit`
- `priorityWeight`

### `POST /api/admin/v1/accounts/:id/rotate-refresh-token`

Purpose:

- replace the stored refresh token

Request:

```json
{
  "refreshToken": "new-refresh-token"
}
```

### `POST /api/admin/v1/accounts/:id/refresh-access-token`

Purpose:

- force a token refresh now

Response:

```json
{
  "data": {
    "status": "SUCCESS",
    "accessTokenExpiresAt": "2026-04-03T09:00:00Z"
  }
}
```

### `POST /api/admin/v1/accounts/:id/disable`

Purpose:

- disable one account immediately

### `POST /api/admin/v1/accounts/:id/enable`

Purpose:

- restore one account to active use

## Fingerprint Endpoints

### `GET /api/admin/v1/fingerprints`

Purpose:

- list fingerprint profiles

### `POST /api/admin/v1/fingerprints`

Purpose:

- create a fingerprint profile

Request example:

```json
{
  "name": "macos-arm64-iterm",
  "platform": "darwin",
  "platformRaw": "darwin",
  "arch": "arm64",
  "nodeVersion": "v24.3.0",
  "terminal": "iTerm2.app",
  "packageManagers": "npm,pnpm",
  "runtimes": "node",
  "claudeVersion": "2.1.81",
  "claudeVersionBase": "2.1.81",
  "buildTime": "2026-03-20T21:26:18Z",
  "deploymentEnvironment": "unknown-darwin",
  "vcs": "git",
  "promptPlatform": "darwin",
  "promptShell": "zsh",
  "promptOsVersion": "Darwin 24.4.0",
  "promptWorkingDir": "/Users/jack/projects",
  "constrainedMemory": 34359738368,
  "rssMin": 300000000,
  "rssMax": 500000000,
  "heapTotalMin": 40000000,
  "heapTotalMax": 80000000,
  "heapUsedMin": 100000000,
  "heapUsedMax": 200000000
}
```

### `GET /api/admin/v1/fingerprints/:id`

Purpose:

- fetch one fingerprint profile

### `PATCH /api/admin/v1/fingerprints/:id`

Purpose:

- update profile values

### `POST /api/admin/v1/fingerprints/:id/validate`

Purpose:

- run profile consistency checks without saving

Response:

```json
{
  "data": {
    "valid": true,
    "warnings": []
  }
}
```

### `POST /api/admin/v1/fingerprints/:id/clone`

Purpose:

- duplicate a profile as a starting point for another account

## Proxy Endpoints

### `GET /api/admin/v1/proxies`

Purpose:

- list proxy nodes

Filters:

- `status`
- `region`
- `networkType`
- `provider`

### `POST /api/admin/v1/proxies`

Purpose:

- create one proxy node

Request:

```json
{
  "name": "us-west-resi-01",
  "type": "HTTP",
  "provider": "provider-a",
  "region": "us-west",
  "city": "los-angeles",
  "networkType": "RESIDENTIAL",
  "endpointHost": "proxy.example.net",
  "endpointPort": 9000,
  "username": "proxy-user",
  "password": "proxy-pass",
  "supportsTls": true,
  "tags": ["west", "resi"]
}
```

### `GET /api/admin/v1/proxies/:id`

Purpose:

- fetch one proxy node

### `PATCH /api/admin/v1/proxies/:id`

Purpose:

- update metadata or endpoint settings

### `POST /api/admin/v1/proxies/:id/test`

Purpose:

- run a health test against the proxy

Response:

```json
{
  "data": {
    "status": "HEALTHY",
    "latencyMs": 182,
    "resolvedRegion": "us-west",
    "error": null
  }
}
```

### `POST /api/admin/v1/proxies/:id/disable`

Purpose:

- stop scheduling this proxy

### `POST /api/admin/v1/proxies/:id/enable`

Purpose:

- restore this proxy

## Client Endpoints

### `GET /api/admin/v1/clients`

Purpose:

- list client machines

### `POST /api/admin/v1/clients`

Purpose:

- create a client machine and issue one token

Request:

```json
{
  "name": "macbook-dev-01",
  "defaultPolicyId": "pol_123",
  "tags": ["dev", "team-a"]
}
```

Response:

```json
{
  "data": {
    "client": {
      "id": "client_123",
      "name": "macbook-dev-01",
      "status": "ACTIVE",
      "defaultPolicyId": "pol_123"
    },
    "issuedToken": "raw-token-only-returned-once"
  }
}
```

### `GET /api/admin/v1/clients/:id`

Purpose:

- fetch one client machine

### `PATCH /api/admin/v1/clients/:id`

Purpose:

- update metadata and bindings

### `POST /api/admin/v1/clients/:id/rotate-token`

Purpose:

- rotate the client bearer token

Response:

```json
{
  "data": {
    "issuedToken": "new-raw-token-only-returned-once"
  }
}
```

### `POST /api/admin/v1/clients/:id/disable`

Purpose:

- disable gateway access for that client

## Policy Endpoints

### `GET /api/admin/v1/policies`

Purpose:

- list routing policies

### `POST /api/admin/v1/policies`

Purpose:

- create a routing policy

Request:

```json
{
  "name": "team-a-west",
  "priority": 100,
  "matchMode": "FIRST_MATCH",
  "clientMachineIds": ["client_123"],
  "accountSelectionStrategy": "ROUND_ROBIN",
  "accountPool": ["acct_1", "acct_2"],
  "proxySelectionStrategy": "LEAST_LATENCY",
  "proxyPool": ["px_1", "px_2"],
  "fallbackStrategy": "TRY_NEXT_ACCOUNT_AND_PROXY"
}
```

### `GET /api/admin/v1/policies/:id`

Purpose:

- fetch one routing policy

### `PATCH /api/admin/v1/policies/:id`

Purpose:

- update one routing policy

### `POST /api/admin/v1/policies/:id/simulate`

Purpose:

- preview which account and proxy a sample request would use

Request:

```json
{
  "clientMachineId": "client_123",
  "requestPath": "/v1/messages",
  "headers": {
    "x-test": "1"
  }
}
```

Response:

```json
{
  "data": {
    "matched": true,
    "selectedAccountId": "acct_2",
    "selectedProxyId": "px_1",
    "trace": [
      "policy matched by clientMachineId",
      "account strategy ROUND_ROBIN selected acct_2",
      "proxy strategy LEAST_LATENCY selected px_1"
    ]
  }
}
```

## Session Endpoints

### `GET /api/admin/v1/sessions`

Purpose:

- inspect recent runtime selections and failures

Filters:

- `clientMachineId`
- `claudeAccountId`
- `proxyNodeId`
- `status`
- `startedAfter`

### `GET /api/admin/v1/sessions/:id`

Purpose:

- inspect one runtime session

## Audit Endpoints

### `GET /api/admin/v1/audit`

Purpose:

- list audit records

Filters:

- `actorType`
- `actorId`
- `targetType`
- `targetId`
- `action`
- `createdAfter`

### `GET /api/admin/v1/audit/:id`

Purpose:

- fetch one audit record

## Health Endpoints

### `GET /api/admin/v1/health/overview`

Purpose:

- summarize system health

Response:

```json
{
  "data": {
    "gateway": "HEALTHY",
    "accounts": {
      "healthy": 8,
      "degraded": 1,
      "unhealthy": 2
    },
    "proxies": {
      "healthy": 12,
      "degraded": 3,
      "unhealthy": 1
    }
  }
}
```

### `GET /api/admin/v1/health/accounts`

Purpose:

- return account health details

### `GET /api/admin/v1/health/proxies`

Purpose:

- return proxy health details

## Dashboard Endpoints

### `GET /api/admin/v1/dashboard/summary`

Purpose:

- provide the admin console homepage snapshot

Suggested fields:

- total active accounts
- total healthy proxies
- total active clients
- requests in last 1 hour
- failed requests in last 1 hour
- accounts in cooldown
- proxies in cooldown

## Security Rules

The admin API should follow these rules from the start:

- never return raw refresh tokens in normal responses
- never return proxy passwords in list responses
- only return newly issued client tokens once
- audit all mutating actions
- separate admin auth from runtime gateway auth
- apply rate limiting to login and sensitive endpoints

## Suggested Implementation Order

Implement the control plane API in this order:

1. accounts
2. fingerprints
3. proxies
4. clients
5. policies
6. health
7. audit
8. dashboard

That order matches the likely dependency chain for the admin UI and keeps early value high.

## Minimum First UI Flow

If the team wants the smallest useful admin console, the first complete operator flow should be:

1. create fingerprint profile
2. create Claude account
3. create proxy node
4. create client machine and receive token
5. create routing policy
6. test account refresh
7. test proxy health
8. simulate routing

Once those steps work end-to-end, the fork has moved beyond a proof of concept into a manageable platform.
