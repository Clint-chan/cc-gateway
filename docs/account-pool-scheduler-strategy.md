# Account Pool Scheduler Strategy

## Core Position

The future platform should schedule around **Claude accounts**, not around end users.

That means:

- the scheduler's main resource is the `ClaudeAccount`
- the outward machine story is stable per account
- multiple end users may share one account, but they should not make that account look like five unrelated devices

This keeps the runtime aligned with the fingerprint strategy:

- one account
- one stable fingerprint profile
- one sticky dedicated proxy or a very narrow sticky proxy set

## Why Account-Centric Scheduling Matters

If the platform treats each end user as an isolated runtime identity, one shared Claude account will quickly emit conflicting signals:

- different workstation stories
- different proxy regions
- different process shapes
- different transport histories

That is the wrong abstraction.

The correct abstraction is:

- end users are clients of the control plane
- Claude accounts are scarce upstream resources
- fingerprints and proxies are account-scoped strategy inputs

## Scheduler Rules

### 1. Stable Identity Per Account

For each Claude account, keep stable by default:

- `device_id`
- `email`
- fingerprint profile binding
- proxy binding
- client persona family

Shared use of one account should still look like one coherent workstation story.

### 2. Cross-Account Diversity

Different Claude accounts should not all share the exact same outward story.

Use a small curated library of realistic profile families and bind them deliberately across the fleet.

Good diversity dimensions:

- platform family
- shell / terminal family
- runtime and package-manager mix
- process ranges
- proxy region and provider class

Bad diversity:

- per-request randomization
- per-user randomization on the same account
- arbitrary field churn with no coherent machine narrative

### 3. Busy/Idle Ownership

Each Claude account should expose a scheduler state such as:

- `IDLE`
- `BUSY`
- `DRAINING`
- `COOLDOWN`

The scheduler should avoid unsafe fan-out on one account.
If an account is already serving a risky or heavy request, later work should queue or route elsewhere instead of piling onto the same upstream identity.

### 4. Budget-Aware Scheduling

The scheduler should not rely only on fixed concurrency.

It should ingest upstream signals such as:

- rolling-window utilization
- reset time
- quota-surpassed flags
- retry-after hints

These become local budget state, which then drives:

- route admission
- queueing
- draining
- cooldown
- spare-account activation

### 5. Peak-Hour Policy

The platform should treat peak-hour traffic as a first-class routing dimension.

The runtime should support:

- down-weighting fragile accounts during peak hours
- routing heavy requests to safer capacity pools
- holding burst traffic in queue instead of forcing direct execution

Peak-hour policy belongs in scheduler strategy, not in ad hoc operator habits.

### 6. Session Affinity

Multi-turn conversations should stay on the same account whenever possible.

Reasons:

- preserve cache locality
- reduce fresh-input burn
- keep the upstream narrative stable
- reduce account hopping that makes one user session look fragmented

This means the scheduler should track an affinity key such as:

- conversation id
- normalized client session id
- context hash

### 7. Proxy Isolation

One Claude account should normally map to:

- one dedicated sticky proxy
or
- one very small sticky failover set

Do not treat the proxy pool like a generic round-robin transport layer.

Proxy churn across one account makes the account identity less coherent.

### 8. Queue and Retry

When there is no safe account available, the system should queue.

The queue should be preferred over reckless overload because:

- queue delay is recoverable
- upstream quota burns and circuit-breaker trips are not

Retry behavior should:

- honor explicit `retry-after`
- otherwise use exponential backoff with jitter
- preserve affinity where possible

### 9. Drain and Circuit Breaker

Accounts approaching dangerous utilization should be drained before they hard-fail.

This requires:

- soft thresholds
- hard thresholds
- temporary exclusion from new routing
- operator-visible reason codes

## What This Means For Product Architecture

### Account Pool

The account pool is the primary runtime fleet object.

Each account should carry:

- auth state
- health state
- capacity state
- fingerprint binding
- proxy binding
- session-affinity state

### Fingerprint Library

The fingerprint library is a reusable asset layer.

It should be:

- versioned
- reviewable
- hot-updateable later

But it should not become a per-user customization surface for one shared account.

### Proxy Pool

The proxy pool is not just connectivity infrastructure.

It is part of the account narrative and risk envelope.

That means:

- proxy assignment policy should live beside account policy
- proxy health should feed scheduler decisions
- account/proxy isolation should be explicit in the control plane

## Immediate Priority

The next implementation priority is not a full account-pool product UI.

The next priority is to make this model real in the substrate:

1. finish the file-backed fingerprint asset layer
2. formalize account-capacity and scheduler data fields
3. extract scheduler-facing interfaces from the runtime
4. only then implement account pool and proxy pool as real control-plane modules

## Source Inputs

This strategy is derived from:

- current transport and telemetry capture evidence in this repository
- the current account-centric fingerprint rules
- the business architecture report under `docs/business/`

The report is treated as architectural input for scheduler shape, not as runtime truth by itself.
