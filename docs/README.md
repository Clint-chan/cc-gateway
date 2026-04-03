# CC Gateway Docs

## Purpose

This folder tracks the fork planning and deployment notes for the project.

The goal is to keep product direction, data model, API shape, and operational steps in one place so future changes can follow the same baseline instead of being rediscovered repeatedly.

## Documents

### Planning

- [architecture-roadmap.md](./architecture-roadmap.md)
  Overall fork direction, recommended module split, and phased refactor path.

- [data-model.md](./data-model.md)
  Core entities for accounts, fingerprints, proxies, clients, policies, sessions, and audit records.

- [api-design.md](./api-design.md)
  Control plane API design for the future admin backend and web console.

### Operations

- [operations.md](./operations.md)
  Local Docker deployment, credential preparation, startup validation, and operational notes.

- [auth-proxy-debugging.md](./auth-proxy-debugging.md)
  Detailed record of the Windows auth/proxy debugging path, MITM evidence, final working client setup, and Docker follow-up notes.

### Client Onboarding

- [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)
  Minimal example for pointing Claude Code directly at the gateway with a distributed client token.

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
