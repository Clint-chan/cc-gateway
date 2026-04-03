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
- one typed capacity profile loaded from runtime config, with synthesized defaults when omitted
- one observe-only scheduler mode
- one sticky-affinity map
- one active-lease map for request lifecycle tracking
- one in-memory budget-state observer fed by upstream rate-limit headers
- one in-memory usage observer fed by `/api/oauth/usage`

This means the runtime already has explicit concepts for:

- account id
- fingerprint profile id
- capacity profile id
- proxy binding
- session affinity
- busy/idle state
- quota state
- drain state
- rolling-window utilization observation
- structured 5-hour / weekly usage snapshots

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

The runtime now accepts a structured capacity profile from config, including:

- `id`
- `admission_mode`
- `max_active_sessions_hint`
- `rolling_window_budget_hint`
- `weekly_budget_hint`
- `peak_hour_multiplier`
- `drain_threshold`

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

### Budget State Observation

When upstream responses include rate-limit headers, the scheduler now ingests them into in-memory account state.

Current observed fields:

- highest seen unified utilization value
- reset timestamp
- surpassed-threshold signal
- `retry-after`
- derived `quota_state`
- derived `drain_state`

This does not yet block requests.
It only exposes the right account state so later queueing, drain, cooldown, and capacity-aware routing have a stable foundation.

### Structured Usage Observation

When the runtime proxies `GET /api/oauth/usage`, the scheduler now ingests the structured usage payload into account state.

Current observed fields:

- `five_hour`
- `seven_day`
- `seven_day_sonnet`
- `seven_day_opus`
- `extra_usage`
- derived `usage_pressure_state`

This is the scheduler's account-budget view, not the live limiter view.

It is useful because it exposes the actual usage windows that back the Claude Code `/usage` screen.

## Health Surface

`/_health` now includes a scheduler snapshot with:

- `account_id`
- `fingerprint_profile_id`
- `capacity_profile_id`
- `busy_state`
- `drain_state`
- `quota_state`
- `active_sessions`
- `sticky_affinities`
- `admission_mode`
- `max_active_sessions_hint`
- `rolling_window_utilization`
- `rolling_window_resets_at`
- `retry_after_seconds`
- `threshold_surpassed`
- `rolling_window_budget_hint`
- `weekly_budget_hint`
- `peak_hour_multiplier`
- `drain_threshold`
- `raw_budget_header_count`
- `usage_pressure_state`
- `usage_observed_at`
- `usage_snapshot`
- `proxy_bound`

This is useful for runtime inspection and later operator-facing health views.

## Current Limits

This substrate does **not** yet do:

- queueing
- retry scheduling
- true multi-account selection
- peak-hour policy
- drain/circuit-breaker enforcement
- sticky proxy failover sets

Even though the scheduler now **observes** budget state, it still does not enforce budget-aware admission.

It also does not actively poll `/api/oauth/usage`; it only ingests that response when the path is proxied through the gateway or an operator probes it directly.

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

1. add account Busy/Idle/Drain reason codes
2. add session-affinity-aware dispatch interfaces
3. combine limiter headers and structured usage into admission decisions
4. add queueing, drain, and cooldown policies
5. only then add multi-account selection
