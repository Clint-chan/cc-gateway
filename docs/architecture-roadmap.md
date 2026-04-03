# CC Gateway Fork Architecture Roadmap

## Purpose

This document captures the planned evolution of the current `cc-gateway` codebase into an internal platform with:

- a web admin console
- account pool management for multiple Claude accounts
- per-account fingerprint profiles
- proxy pool management
- better operational visibility and safer credential handling

The current repository is a good proof of concept for request rewriting, but it is still a single-process gateway with file-based configuration. If we want this project to become an operational system, we should separate concerns now instead of continuing to stack features into the existing entrypoint.

## Current State

Today the project is organized as a small backend-only proxy:

- `src/index.ts`: process entrypoint
- `src/proxy.ts`: HTTP/HTTPS server and upstream forwarding
- `src/auth.ts`: static bearer-token authentication
- `src/oauth.ts`: single refresh token lifecycle
- `src/rewriter.ts`: request body and header rewriting
- `src/config.ts`: YAML config loading
- `src/logger.ts`: console logging
- `src/scripts/*`: helper generators

Characteristics of the current design:

- single gateway instance
- single upstream account context
- static YAML configuration
- no database
- no admin UI
- no account scheduling or routing policy
- no proxy pool abstraction

This is enough for a single canonical identity, but not enough for an account fleet.

## Fork Goals

The fork should support three product directions at the same time:

1. Gateway core
   A stable reverse proxy layer that can rewrite telemetry and forward traffic safely.
2. Control plane
   A management API and web console for accounts, fingerprints, proxies, tokens, audit logs, and routing rules.
3. Runtime scheduling
   Logic that decides which Claude account and which outbound proxy should be used for each request or client.

## Recommended Target Architecture

Split the system into four major areas:

### 1. Gateway Runtime

Responsibility:

- receive Claude Code traffic
- authenticate client machines
- resolve routing target
- load the selected account profile and fingerprint profile
- optionally select an outbound proxy
- rewrite request headers and body
- inject the correct OAuth token
- forward traffic upstream
- emit audit events and metrics

This part should stay focused on data plane behavior and remain fast.

### 2. Management API

Responsibility:

- CRUD for Claude accounts
- CRUD for fingerprint profiles
- CRUD for proxy nodes
- CRUD for client machines and client tokens
- policy management for routing
- health and usage APIs
- operator login and RBAC later if needed

This becomes the backend for the admin UI and the automation layer.

### 3. Scheduler / Policy Engine

Responsibility:

- choose account by policy
- bind account to a fingerprint profile
- bind account or request to a proxy node
- enforce cooldown, concurrency, quota, or region rules
- mark accounts/proxies unhealthy when repeated failures happen

This should be an explicit module, not hidden inside `proxy.ts`.

### 4. Admin Console

Responsibility:

- operator dashboard
- account inventory
- fingerprint profile editor
- proxy pool dashboard
- client machine management
- request audit and failure inspection
- health overview

This is a control plane UI, not part of the request path.

## Core Domain Model

The next version should stop treating configuration as one flat YAML file. These entities should become first-class records:

### Claude Account

Fields:

- `id`
- `name`
- `status`
- `refreshToken`
- `accessToken`
- `accessTokenExpiresAt`
- `email`
- `deviceId`
- `fingerprintProfileId`
- `defaultProxyId`
- `tags`
- `notes`

Notes:

- one account can have one default fingerprint profile
- one account can also be routed dynamically to different proxies
- sensitive tokens should be encrypted at rest

### Fingerprint Profile

Fields:

- `id`
- `name`
- `platform`
- `arch`
- `nodeVersion`
- `terminal`
- `packageManagers`
- `runtimes`
- `claudeVersion`
- `buildTime`
- `deploymentEnvironment`
- `promptEnv`
- `processMetricsTemplate`

Notes:

- this replaces the current single `identity/env/prompt_env/process` block
- different accounts may intentionally use different stable profiles

### Proxy Node

Fields:

- `id`
- `name`
- `type`
- `region`
- `provider`
- `endpoint`
- `authConfig`
- `healthStatus`
- `latencyMs`
- `successRate`
- `tags`

Examples:

- US West residential proxy
- static ISP proxy
- datacenter proxy

### Client Machine

Fields:

- `id`
- `name`
- `tokenHash`
- `status`
- `allowedPolicies`
- `lastSeenAt`
- `notes`

Notes:

- do not store raw client bearer tokens once issued if avoidable
- store a hash and only show the token once on creation

### Routing Policy

Fields:

- `id`
- `name`
- `matchRules`
- `accountSelectionStrategy`
- `proxySelectionStrategy`
- `fallbackStrategy`
- `status`

Examples:

- machine A always uses account A plus proxy group west-resi
- machine B can use any warm account tagged `team-1`
- burst traffic uses least-loaded healthy account

## Recommended Repository Structure

Before doing the full split below, keep [repository-layout.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/repository-layout.md) as the day-to-day rulebook for where runtime code, tests, capture assets, logs, and reference materials belong.

One practical structure for the fork:

```text
docs/
  architecture-roadmap.md
  api-design.md
  data-model.md
  operations.md

apps/
  gateway/
    src/
      index.ts
      server/
      middleware/
      routes/
      services/
      rewrite/
      upstream/
      policy/
      telemetry/
  admin-api/
    src/
      index.ts
      modules/
        accounts/
        fingerprints/
        proxies/
        clients/
        policies/
        audit/
  admin-web/
    src/
      app/
      pages/
      components/
      features/
        accounts/
        fingerprints/
        proxies/
        clients/
        policies/
        dashboard/

packages/
  shared-types/
  config/
  logger/
  crypto/
  database/
  policy-engine/
  rewrite-engine/
  oauth-manager/

scripts/
  dev/
  migrate/
  seed/

infra/
  docker/
  compose/
  nginx/
  monitoring/

tests/
  integration/
  e2e/
```

## Suggested Incremental Refactor Path

Do this in stages instead of rewriting everything at once.

### Stage 1. Refactor the current backend into modules

Goal:

- keep behavior unchanged
- prepare for future extension

Work:

- move current gateway code under `apps/gateway`
- extract shared rewrite logic into `packages/rewrite-engine`
- extract OAuth token handling into `packages/oauth-manager`
- extract config schema and validation into a dedicated module
- define interfaces for account store and proxy store even if they still read YAML initially

### Stage 2. Introduce persistent storage

Goal:

- stop depending on one static config file

Work:

- add a database
- move accounts, fingerprints, proxies, clients, and policies into tables
- encrypt refresh tokens and proxy credentials
- add migrations and seed scripts

### Stage 3. Add management API

Goal:

- make the system operable without editing files by hand

Work:

- build REST or RPC endpoints for all core entities
- add health endpoints and audit query endpoints
- expose account refresh status and proxy health

### Stage 4. Add admin web UI

Goal:

- let operators manage the platform visually

Initial pages:

- dashboard
- accounts
- fingerprint profiles
- proxy pool
- clients
- routing policies
- audit logs

### Stage 5. Add smart routing

Goal:

- support multiple accounts and multiple outbound proxies safely

Work:

- account selection strategies
- proxy selection strategies
- backoff and cooldown
- failure classification
- automatic unhealthy marking

## Feature Notes

### Frontend Management UI

The UI should be treated as a control plane. It should not be required for the gateway request path to function.

Minimum useful features:

- create and disable Claude accounts
- bind an account to a fingerprint profile
- view token refresh status
- create and test proxy nodes
- assign clients and routing policies
- inspect recent request outcomes

### Account Pool Management

This is more than storing multiple refresh tokens.

The system should eventually support:

- one fingerprint per account by default
- account labels and grouping
- account health status
- concurrent usage limits
- cooldown after repeated failures
- manual disable and quarantine

### Proxy Pool Management

Proxy support should be explicit in upstream forwarding, not bolted on later.

Capabilities we should plan for:

- HTTP and SOCKS proxy support
- regional tagging
- provider tagging
- latency and health tracking
- default proxy per account
- policy-based proxy selection

### Fingerprint Profiles

A fingerprint should become a named reusable object, not just a block in one config file.

Important rule:

- keep profiles internally consistent

Example:

- platform says `darwin`
- prompt environment says `zsh`
- version fields match the User-Agent and billing header rewrite
- process metrics look realistic for the declared machine

## Security and Operations Notes

As the project grows, these concerns become mandatory:

- encrypt account refresh tokens at rest
- hash client bearer tokens where possible
- separate operator auth from gateway client auth
- add audit logs for account, proxy, and policy changes
- protect admin APIs behind proper authentication
- avoid exposing `_health` and internal metadata publicly
- add rate limiting for management endpoints
- define secret rotation procedures

## Near-Term Recommendation

Before building features, do one structural cleanup PR first:

1. introduce `docs/`
2. move current proxy code toward an `apps/gateway` shape
3. define the future entities in code interfaces
4. keep YAML config as a temporary adapter

That gives us a stable base for the real fork instead of extending a proof-of-concept layout indefinitely.
