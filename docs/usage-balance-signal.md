# Usage Balance Signal

## Purpose

This document freezes how Claude Code exposes structured usage and balance state.

It exists because the live limiter headers and the `/usage` surface are not the same thing:

- limiter headers describe live request-time pressure
- `/api/oauth/usage` describes account usage windows and extra-usage state

Both matter for an account-centric scheduler.

## Source of Truth

The Claude Code `/usage` UI is backed by:

- [usage.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/usage.ts)
- [Usage.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/components/Settings/Usage.tsx)

The relevant request is:

- `GET /api/oauth/usage`

In the current leaked source, this request is sent to:

- `getOauthConfig().BASE_API_URL`

For production, that resolves to:

- `https://api.anthropic.com`

So this surface is compatible with the gateway's current single-upstream runtime model.

## What It Returns

Current response fields include:

- `five_hour`
- `seven_day`
- `seven_day_sonnet`
- `seven_day_opus`
- `extra_usage`

The rate-limit objects expose:

- `utilization`
- `resets_at`

`extra_usage` additionally exposes:

- `is_enabled`
- `monthly_limit`
- `used_credits`
- `utilization`

## Why This Is Different From Limiter Headers

Claude Code also derives usage pressure from normal API responses:

- `anthropic-ratelimit-unified-5h-*`
- `anthropic-ratelimit-unified-7d-*`
- `retry-after`

That path is implemented in:

- [claudeAiLimits.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/claudeAiLimits.ts)

Use the distinction below:

- `/api/oauth/usage`
  account usage snapshot
- `/v1/messages` headers
  live limiter state

## Current Gateway Integration

The runtime scheduler now observes `/api/oauth/usage` responses and stores a structured usage snapshot in memory.

Current health exposure includes:

- `usage_pressure_state`
- `usage_observed_at`
- `usage_snapshot.five_hour`
- `usage_snapshot.seven_day`
- `usage_snapshot.seven_day_sonnet`
- `usage_snapshot.seven_day_opus`
- `usage_snapshot.extra_usage`

This remains observe-only.

It does not yet:

- block traffic
- reschedule traffic
- rebalance between accounts

## Probe Strategy

For automation and reverse engineering, do not drive the interactive `/usage` screen.

The interactive command is useful for manual validation, but the stable research probe is the protocol request itself:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\probe-usage-via-gateway.ps1
```

That is preferable because it:

- avoids TUI capture noise
- works in scripts
- directly exercises the scheduler ingestion path

## Scheduler Interpretation

The current runtime converts usage percentages to the same `0..1` scale used by budget hints.

Current advisory state rules are:

- `EXHAUSTED`
  any observed window reaches `1.0`
- `LIMITED`
  `five_hour >= rolling_window_budget_hint` or
  weekly windows >= `weekly_budget_hint`
- `NORMAL`
  usage exists but stays under hints
- `UNKNOWN`
  no usable structured usage windows were returned

This is intentionally separate from live limiter-state exhaustion, which still comes from response headers.

The runtime now also folds this signal into observe-only:

- `admission_advice`
- `admission_reason_codes`

That means `/api/oauth/usage` is no longer just an operator report surface.
It is now a scheduler input.

## Next Step

The next scheduler step should combine both sources:

1. live limiter headers for immediate backpressure
2. `/api/oauth/usage` for account-level budget planning

That is the right substrate for later:

- account pool admission
- weekly budget shaping
- overage-aware routing
- operator-facing account dashboards
