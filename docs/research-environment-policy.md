# Research Environment Policy

## Purpose

This document freezes one operational rule:

> For transport, telemetry, and fingerprint-alignment research, the canonical baseline is the local Node runtime. Docker is a deployment-validation environment, not the primary reverse-engineering baseline.

This distinction must stay explicit so future captures do not mix deployment noise with first-party client behavior.

## Canonical Baseline

Use the local runtime when the goal is any of the following:

- packet capture
- MITM alignment
- direct vs via-gateway diff
- auth-mode comparison
- side-channel ownership triage
- telemetry schema tracking after a Claude Code upgrade

Recommended local workflow:

```powershell
npm run build
npm start
```

Then run the existing capture scripts against that host process.

## Why Local npm Is the Research Baseline

Local Node is the cleanest research surface because it:

- matches the host process model more closely
- avoids Docker Desktop proxy indirection
- avoids container NAT and port-publish noise
- avoids host alias translation such as `host.docker.internal`
- makes `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and `NODE_EXTRA_CA_CERTS` easier to reason about
- reduces ambiguity when classifying a behavior change as `auth mode`, `traffic mode`, `transport ownership`, or `rewrite gap`

In short:

- local npm is for facts
- Docker is for packaging

## When Docker Should Be Used

Use Docker when the goal is:

- deployment verification
- compose/runtime packaging checks
- operator smoke tests
- validating that `.env + config.yaml` still boot correctly in a container
- checking runtime-side proxy reachability from inside the container

Docker should not be the default choice when the goal is to explain a telemetry change.

## Practical Rule

When a Claude Code update lands, triage in this order:

1. reproduce with local npm
2. freeze the new transport/telemetry facts
3. update rewrite logic or documentation if needed
4. only then re-run the same scenario in Docker to confirm packaging parity

Do not invert this order.

## Shared Config Rule

The current config model is:

- `.env` for deployment values and secrets
- `config.yaml` for the structured fingerprint persona and rewrite policy

This split is shared across:

- local npm
- Docker Compose
- later `admin-api` / `admin-web`

That does not mean the environments are equal for research.
They share config shape, but not diagnostic value.

## Capture Guidance

For capture work:

- prefer local npm
- keep Docker out of the primary diff unless you are explicitly studying container behavior
- store generated reports under `artifacts/reports/`
- store reusable capture tools under `scripts/` or `mitm/`
- keep conclusions in:
  - [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
  - [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
  - [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)

## Exit Rule

If a result is only reproduced in Docker but not in local npm, do not freeze it as an upstream transport fact until the Docker layer has been ruled out as the cause.
