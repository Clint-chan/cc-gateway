# CC Gateway Docs

## Purpose

This folder tracks the fork planning and deployment notes for the project.

The goal is to keep product direction, data model, API shape, and operational steps in one place so future changes can follow the same baseline instead of being rediscovered repeatedly.

## Documents

### Planning

- [architecture-roadmap.md](./architecture-roadmap.md)
  Overall fork direction, recommended module split, and phased refactor path.

- [repository-layout.md](./repository-layout.md)
  Repository structure rules for runtime code, tests, capture assets, logs, and the later gateway/admin-api/admin-web split.

- [status-and-exit-criteria.md](./status-and-exit-criteria.md)
  Current phase assessment, v1 exit criteria for transport/telemetry work, and an estimated timeline to close this layer.

- [data-model.md](./data-model.md)
  Core entities for accounts, fingerprints, proxies, clients, policies, sessions, and audit records.

- [api-design.md](./api-design.md)
  Control plane API design for the future admin backend and web console.

### Operations

- [operations.md](./operations.md)
  Local Docker deployment, credential preparation, startup validation, and operational notes.

- [auth-proxy-debugging.md](./auth-proxy-debugging.md)
  Detailed record of the Windows auth/proxy debugging path, MITM evidence, final working client setup, and Docker follow-up notes.

- [client-modes.md](./client-modes.md)
  Separation between traffic mode and auth mode for Claude Code clients.

- [transport-surface-map.md](./transport-surface-map.md)
  Map of which requests belong to the gateway mainline, which bypass to first-party hosts, and which are gated off by mode.

- [auth-mode-control-plane-matrix.md](./auth-mode-control-plane-matrix.md)
  Frozen matrix for auth-mode-sensitive control-plane behavior in the trusted via-gateway workflow.

- [event-logging-threshold-workflow.md](./event-logging-threshold-workflow.md)
  Repeatable workflow for measuring the minimum trigger threshold of 1P event logging.

- [grove-control-plane-gating.md](./grove-control-plane-gating.md)
  Frozen explanation for why Grove control-plane surfaces disappear under current via-gateway auth models, and how to distinguish auth suppression from capture failure.

- [remote-control-gating.md](./remote-control-gating.md)
  Frozen explanation for why `claude remote-control` exits early under different auth identities, and how to map its error text back to subscriber, profile, organization, or bridge-gate causes.

- [packet-alignment-log.md](./packet-alignment-log.md)
  Single running log for every telemetry, header, and body alignment fix against captured first-party Claude Code traffic.

- [fingerprint-catalog.md](./fingerprint-catalog.md)
  Central catalog of fingerprint surfaces, evidence paths, code ownership, and update workflow.

- [growthbook-eval-investigation.md](./growthbook-eval-investigation.md)
  Dedicated investigation log for `/api/eval/*`, trust gating, disk cache behavior, and the current capture strategy.

- [trusted-capture-workflow.md](./trusted-capture-workflow.md)
  Dedicated workflow for creating a separate trusted capture workspace and probing GrowthBook-dependent paths without mixing home or repo trust state.

- [rapid-triage-playbook.md](./rapid-triage-playbook.md)
  Fast triage playbook for classifying new CLI or telemetry changes into traffic mode, auth mode, transport ownership, or rewrite gaps.

- [telemetry-automation-plan.md](./telemetry-automation-plan.md)
  Semi-automation roadmap for recurring capture, parsing, diffing, and manual review.

### Client Onboarding

- [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)
  Quiet-mode example for pointing Claude Code directly at the gateway with a distributed client token.

- [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)
  Alignment-mode example for telemetry capture and MITM research.

## Suggested Update Rules

When the project evolves, update docs in this order:

1. update the relevant design document first
2. align runtime config, API, or code structure changes
3. add deployment or migration notes if operator behavior changed

## Current Status

As of now:

- the repository is still a backend-only gateway
- local Docker deployment files exist
- admin UI and control plane APIs are still planning-stage work
- the current runtime still depends on a single `config.yaml`

This means the docs describe both:

- the current deployable proof of concept
- the target platform direction for the fork
