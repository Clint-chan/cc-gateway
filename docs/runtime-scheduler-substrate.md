# Runtime Scheduler Substrate

## Purpose

This document explains the current runtime scheduler substrate inside the gateway.

It is intentionally smaller than a future account-pool scheduler.
Its job today is:

- make the runtime think in account-centric terms
- expose stable routing/session concepts
- keep current single-account behavior intact
- avoid a second large refactor later when account pool work begins

## Current Scope

The current runtime now routes requests through a scheduler abstraction even though the gateway still serves one managed Claude account.

Current implementation:

- one synthesized runtime account derived from the active gateway config
- one synthesized capacity profile
- one observe-only scheduler mode
- one sticky-affinity map
- one active-lease map for request lifecycle tracking

This means the runtime already has explicit concepts for:

- account id
- fingerprint profile id
- capacity profile id
- proxy binding
- session affinity
- busy/idle state

## Why This Exists Before Account Pool

Without this layer, account-pool work would have to begin by ripping logic back out of `proxy.ts`.

That is the wrong order.

The right order is:

1. single-account runtime adopts the right scheduling abstractions
2. account pool later swaps in a real multi-account selector

That keeps the current gateway usable while reducing later churn.

## Current Behavior

### Single Runtime Account

The runtime synthesizes one account object from:

- `identity.email`
- `identity.device_id`
- `fingerprint_profile`
- `network.proxy_url`

The account id is deterministic and derived from the account email.

### Capacity Profile

The runtime also synthesizes one capacity profile:

- `admission_mode = observe-only`
- `max_active_sessions_hint = 1`

This is intentionally not enforcing concurrency yet.

It is a substrate, not a finished scheduler policy.

### Session Affinity

The scheduler extracts an affinity key from:

1. request headers such as `x-session-affinity-key`
2. request body fields such as:
   - top-level `conversation_id`
   - top-level `session_id`
   - `metadata.user_id.session_id`

This lets the runtime start tracking “same conversation should stay on same account” before a full queueing or multi-account implementation exists.

### Busy / Idle

Each active proxied request gets a lease.

While one or more leases are open:

- account `busy_state = BUSY`

When all leases finish:

- account `busy_state = IDLE`

This gives us a stable place to add real admission control later.

## Health Surface

`/_health` now includes a scheduler snapshot with:

- `account_id`
- `fingerprint_profile_id`
- `capacity_profile_id`
- `busy_state`
- `drain_state`
- `active_sessions`
- `sticky_affinities`
- `admission_mode`
- `max_active_sessions_hint`
- `proxy_bound`

This is useful for runtime inspection and later operator-facing health views.

## Current Limits

This substrate does **not** yet do:

- queueing
- retry scheduling
- true multi-account selection
- budget-aware admission
- peak-hour policy
- drain/circuit-breaker enforcement
- sticky proxy failover sets

Those remain future scheduler work.

## Why `observe-only` Is Correct Right Now

The current project is still validating transport and account-centric abstractions.

If we enforced hard concurrency or queueing too early, we would risk changing gateway behavior before the control-plane model is ready.

So the runtime currently does the right smaller thing:

- expose the right state
- log the right routing decision
- keep admission behavior unchanged

## Next Steps

The next scheduler work should build on this substrate in order:

1. add typed capacity-profile inputs instead of synthetic defaults
2. add account Busy/Idle/Drain reasons
3. add session-affinity-aware dispatch interfaces
4. add budget-state ingestion from upstream signals
5. only then add queueing and multi-account selection
