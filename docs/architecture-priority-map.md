# Architecture Priority Map

## Purpose

This document answers one question:

> From an architecture point of view, what is done, what is partially done, and what should happen next?

It is not another feature wishlist.
Its job is to keep the project moving in the right order.

## Current Architectural Position

The project is no longer a raw reverse-proxy proof of concept.
It is now closer to this shape:

1. a working data-plane gateway
2. a mostly frozen transport/telemetry research framework
3. an early deployment/operations baseline
4. a not-yet-started control-plane platform

That means the repository has crossed the hardest part of the first stage:

- the request path works
- the auth model is understood well enough for real testing
- the major side-channel surfaces are classified
- the research workflow is repeatable

But it has not crossed the second stage yet:

- fully versioned and hot-updateable fingerprint assets
- one-click maintenance automation
- modular runtime boundaries
- persistent control-plane data
- account-centric scheduler substrate

## Current Progress By Layer

### 1. Data Plane Runtime

State: `strong`

What is already true:

- gateway request forwarding works
- upstream auth lifecycle works
- `.env + config.yaml` deployment model is stable
- local npm and Docker Compose both pass health checks
- quiet-mode client onboarding is usable

What is still missing:

- production-grade TLS story
- long-run soak validation
- explicit runtime modular boundaries in code layout

### 2. Research / Counter-Detection Layer

State: `strong`

What is already true:

- control-plane ownership is largely frozen
- eval field relations are frozen enough for maintenance
- event logging threshold and probe sensitivity are frozen enough for maintenance
- local npm is now explicitly frozen as the canonical research baseline
- a report generator exists for current telemetry evidence
- a first outer maintenance entrypoint now exists
- the first file-backed fingerprint asset layer has started
- the runtime can now observe both live limiter headers and structured `/api/oauth/usage` snapshots
- the runtime can now expose observe-only admission advice and reason codes from those signals

What is still missing:

- version-triggered capture/report workflow
- hot-updateable fingerprint/profile asset model
- capture and report scheduling around the current entrypoint

### 3. Deployment / Operations Layer

State: `usable`

What is already true:

- Docker runtime is aligned with local runtime
- Docker build path is operational on this workstation
- runtime logs and artifacts have defined homes
- `.env` is now the shared deployment contract

What is still missing:

- externalized production secrets management
- reusable multi-host deployment pattern
- persistent operational health metrics

### 4. Control Plane / Platform Layer

State: `planned only`

What is already true:

- architecture roadmap exists
- data model exists
- admin API shape exists

What is still missing:

- actual modular code split
- database
- account pool
- proxy pool
- admin API
- admin web

## Knowledge And Product Matrix

This project now has to be prioritized across more than code modules.
It also has to be prioritized across understanding, product maturity, and platform ambition.

### 1. Claude Code Source Understanding

State: `targeted-strong, not exhaustive`

Current reality:

- the transport, auth, telemetry, GrowthBook, quiet-mode, and control-plane surfaces most relevant to the gateway have been studied deeply enough to drive current engineering
- the whole Claude Code codebase has not been “fully mastered” in the literal sense

Priority meaning:

- high priority when a surface affects transport facts or counter-detection
- not a goal to read the entire upstream codebase just for completeness

Operational rule:

- read upstream source by surface, not by curiosity
- prioritize files that explain a newly observed transport change

### 2. This Project Source Understanding

State: `strong on runtime, moderate on future platform split`

Current reality:

- the current gateway runtime, auth flow, rewrite path, config path, capture tooling, and maintenance assets are already understood well enough to keep evolving safely
- what is not yet “fully mastered” is the future modular split, because that split does not exist yet

Priority meaning:

- high priority for runtime cleanup and future extraction work
- lower priority for imagined platform modules that are still only in design documents

### 3. Project Background Understanding

State: `sufficient for current architecture`

Current reality:

- we understand the motivating background well enough:
  - original open-source gateway limitations
  - Claude Code telemetry and control-plane behavior
  - why reverse-proxy rewriting alone is not the whole story
- what is not required right now is broader business packaging or external storytelling

Priority meaning:

- enough background is already present to guide architecture
- background research should continue only when it clarifies a technical or product decision

### 4. Product Maturity

State: `internal research beta, not platform-ready`

Current reality:

- tester access through the gateway is already practical
- transport facts are mostly frozen
- maintenance tooling has started
- the project is not yet a mature operational product

The right label today is closer to:

- strong internal beta for gateway/runtime research
- early alpha for platform/control-plane ambitions

### 5. Frontend / Account Pool / Proxy Pool

State: `planned, not yet implementation-ready`

Current reality:

- the problem statements are valid
- the data model and API drafts exist
- the runtime and asset boundaries underneath them are not finished enough yet

Priority meaning:

- these are important product directions
- they are not the next implementation priority

Start conditions for serious implementation:

- maintenance loop is stable
- fingerprint asset layer exists
- account-centric scheduler substrate exists
- runtime module boundaries are cleaner
- control-plane substrate exists

## What This Means

The project is now at a dangerous but good transition point:

- strong enough to tempt product work
- not yet structured enough to absorb product work safely

It is also at a knowledge transition point:

- enough upstream and local source understanding exists to keep shipping the gateway base safely
- not enough structural stabilization exists to justify jumping straight into UI and fleet-management implementation

So the next priorities must protect the base layer, not decorate it.

## Priority Order

### P0. Freeze the Maintenance Loop

This is the most important next step.

Goal:

- make telemetry maintenance repeatable and low-friction

Concrete outputs:

- one-click maintenance script
- report archive convention
- version-triggered maintenance entrypoint
- clear operator steps for “new Claude version arrived”

Current status:

- the first maintenance entrypoint already exists
- P0 is not “start from zero”, it is “complete the loop around that entrypoint”

Why this is first:

- upstream changes are the main source of future breakage
- if maintenance is slow, every later platform layer will drift

### P1. Extract and Harden the Fingerprint Asset Layer

This is the next architecture step after the maintenance loop.

Goal:

- stop treating the fingerprint persona as a single static block hidden inside one config file

Target shape:

- versioned fingerprint assets
- clear ownership of:
  - client persona
  - env
  - prompt env
  - process profile
  - optional endpoint-specific overrides
- support for hot updates without restructuring deployment secrets
- file-backed loading by stable asset ID

Why this matters:

- it is the foundation for “hot-updateable fingerprint library”
- it is also the bridge between research outputs and future account/fingerprint management
- it is the prerequisite for doing account pool and proxy pool work correctly

This is the highest-value architecture task after P0.

Current status:

- the first file-backed split now exists:
  - account identity remains account-scoped
  - `client / env / prompt_env / process` can be loaded from `profiles/fingerprints/*.yaml`
  - runtime references can already use asset IDs instead of raw file paths
- P1 is no longer a blank idea
- P1 is now in the “expand and harden” phase

Reference:

- [account-fingerprint-strategy.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/account-fingerprint-strategy.md)

### P2. Introduce the Account-Centric Scheduler Substrate

Goal:

- make `ClaudeAccount` the scheduling subject
- preserve stable per-account fingerprint and proxy narratives
- prepare for queueing, drain, cooldown, and budget-aware routing

Focus:

- account Busy/Idle/Drain state
- capacity profiles separated from fingerprint assets
- sticky proxy binding per account
- session-affinity-aware dispatch
- rate-limit-header-driven budget state

Why this comes before frontend work:

- the admin UI must expose the real scheduling model, not invent one
- account pool and proxy pool are meaningless until the scheduler substrate is explicit

### P3. Introduce Runtime Module Boundaries

Goal:

- prepare the current gateway for the later `apps/gateway` split without doing a full monorepo migration yet

Focus:

- isolate config/domain types
- isolate rewrite policy logic
- isolate upstream auth/session logic
- isolate research-only tooling from runtime code

Why now:

- once fingerprint assets become explicit, the runtime needs cleaner module boundaries

### P4. Build the Minimal Control-Plane Substrate

Goal:

- create the smallest possible base for future account pool and proxy pool work

Focus:

- file-backed or sqlite-backed stores
- typed entities for accounts, fingerprints, clients, proxies
- no UI yet
- no platform bells and whistles

Why not earlier:

- building this before P0/P1/P2 would harden the wrong abstractions

This is the stage where account-pool and proxy-pool implementation should actually begin.

### P5. Start Control Plane APIs

Goal:

- expose typed management surfaces for the future UI and automation

Focus:

- CRUD only where the underlying domain model is already stable
- do not mix admin auth with gateway client auth

### P6. Build Admin Web

Goal:

- visual operator workflow

Why last:

- it depends on everything above
- starting here earlier would maximize churn and rework

This is the stage where frontend work becomes architecturally justified.

## What Should Not Be Prioritized Yet

These are explicitly lower priority than P0-P2:

- polished frontend
- broad Claude Code source reading without a surface-driven reason
- full account pool scheduling
- proxy pool UI
- multi-tenant operator system
- advanced RBAC
- production dashboarding

These are valid future directions, but not the right next moves.

## Recommended Next Development Sequence

If we continue from today, the clean order is:

1. keep local npm as the canonical research baseline
2. make maintenance/report generation one-click
3. extract a hot-updateable fingerprint asset layer
4. introduce the account-centric scheduler substrate
5. refactor runtime boundaries around that asset layer
6. only then start the persistent control-plane substrate

## Practical Readiness Summary

From a whole-project perspective:

- transport/telemetry foundation: `near-complete`
- deployment/ops baseline: `good enough`
- maintenance automation: `started but not finished`
- fingerprint asset architecture: `in progress`
- account-centric scheduler substrate: `started with typed capacity input and budget observation`
- Claude Code source understanding for relevant surfaces: `good enough to keep advancing`
- local project source understanding for current runtime: `good enough to refactor safely`
- product maturity: `gateway beta / platform alpha`
- platform/control plane: `not ready to implement at scale`

## Current Recommendation

The next priority is not “build product features”.

The next priority is:

> turn the current research framework into a maintainable operating system for keeping the gateway aligned with upstream changes.

Once that loop is stable, the next structural milestones are:

1. harden the fingerprint asset layer
2. extend the account-centric scheduler substrate from observe-only state into real routing policy
