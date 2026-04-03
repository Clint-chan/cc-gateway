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
- one observe-only admission advisory layer with reason codes

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
- admission advice and operator-visible reason codes

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

### Admission Advisory

The scheduler now derives an observe-only admission advisory from three classes of signal:

- active lease pressure
- live limiter headers
- structured `/api/oauth/usage` snapshots

Current advisory states:

- `OPEN`
- `QUEUE_PREFERRED`
- `BLOCK_NEW`

Current reason codes include:

- `active_leases_present`
- `capacity_hint_reached`
- `live_retry_after`
- `live_threshold_surpassed`
- `live_utilization_above_drain_threshold`
- `usage_five_hour_above_hint`
- `usage_weekly_above_hint`
- `usage_window_exhausted`

This is still observe-only.

It does not yet reject or queue requests, but it gives the runtime, future control plane, and future UI a shared explanation model instead of making each layer infer risk independently.

### Optional Enforcement Hook

The runtime now also exposes a small enforcement hook above that advisory layer.

Current runtime boundary:

- scheduler computes state and previews admission
- admission policy decides whether a configured enforcement mode should reject
- proxy only applies the evaluated result

This boundary now lives in:

- [scheduler.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/scheduler.ts)
- [admission-policy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/admission-policy.ts)
- [proxy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/proxy.ts)

Config shape:

```yaml
admission_control:
  enforcement_mode: observe-only
  reject_status_code: 429
```

Current modes:

- `observe-only`
- `reject-block-new`
- `reject-queue-preferred`

This hook is intentionally narrow:

- it does not implement queueing
- it does not reschedule to another account
- it only gives the gateway a controlled way to reject requests when operators explicitly opt in

This is the correct interim step before a real queue, cooldown, or multi-account selector exists.

## Health Surface

`/_health` now includes a scheduler snapshot with:

- `account_id`
- `fingerprint_profile_id`
- `capacity_profile_id`
- `busy_state`
- `busy_reason_codes`
- `drain_state`
- `drain_reason_codes`
- `admission_advice`
- `admission_reason_codes`
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

Even though the scheduler now **derives** admission advice, it still does not implement real queueing or multi-account budget-aware admission.

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

1. add session-affinity-aware dispatch interfaces
2. combine the enforcement hook with real queueing, drain, and cooldown policy
3. only then add multi-account selection
