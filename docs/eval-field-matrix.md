# Eval Field Matrix

## Purpose

This document freezes the field-level shape of `/api/eval/*` so future Claude Code updates can be triaged without rediscovering the same attribute set by hand.

It answers four questions:

1. Which eval fields exist in the current official schema
2. Which fields stay the same across the two current baselines
3. Which fields are auth-model-sensitive or transport-sensitive
4. Which assets to rerun when the eval surface changes again

## Baselines

### Baseline A: direct subscriber

- Source:
  [direct.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.flows)
- Label:
  `direct-subscriber`
- Meaning:
  local Claude.ai subscriber session, no gateway in the middle

### Baseline B: managed-oauth via-gateway side channel

- Source:
  [dual-direct.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.flows)
- Label:
  `managed-oauth-via-gateway-side-channel`
- Meaning:
  trusted via-gateway capture where the main inference path uses the gateway, but `/api/eval/*` still escapes as a direct-host side channel

### Frozen evidence

- Structured field targets:
  [eval_attribute_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_attribute_targets.json)
- Structured baseline result:
  [eval_field_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_field_matrix_2026-04-03.json)
- Summarizer:
  [summarize_eval_field_matrix.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/summarize_eval_field_matrix.py)

## Schema source

The authoritative schema baseline comes from:

- [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
- [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)

The current target list tracks:

- `attributes.id`
- `attributes.sessionId`
- `attributes.deviceID`
- `attributes.platform`
- `attributes.apiBaseUrlHost`
- `attributes.organizationUUID`
- `attributes.accountUUID`
- `attributes.userType`
- `attributes.subscriptionType`
- `attributes.rateLimitTier`
- `attributes.firstTokenTime`
- `attributes.email`
- `attributes.appVersion`
- `attributes.githubActionsMetadata`
- `url`
- `forcedVariations`
- `forcedFeatures`

## Frozen findings

### 1. `/api/eval/*` is still a direct-host side channel in the current via-gateway path

Current trusted via-gateway captures still show:

- `dual-gateway.flows`
  no `/api/eval/*` on gateway upstream
- `dual-direct.flows`
  `/api/eval/*` present on the direct side channel

That means current `rewriteEvalBody()` coverage is strategically useful, but it does not protect the active managed-oauth path today because the live eval traffic is bypassing the gateway altogether.

### 2. Stable identity and account fields still leak through the side channel

These fields are stable across the current two baselines:

- `attributes.id`
- `attributes.deviceID`
- `attributes.platform`
- `attributes.organizationUUID`
- `attributes.accountUUID`
- `attributes.userType`
- `attributes.email`
- `attributes.appVersion`

Operationally, this means the current direct eval side channel still carries real first-party identity and account linkage even when main inference traffic is routed through the gateway.

### 3. `sessionId` is request-scoped, not a persona field

`attributes.sessionId` stays present, but changes between eval requests.  
This should stay classified as session/runtime noise, not a canonical rewrite target.

### 4. `apiBaseUrlHost` is transport-sensitive and leaks the custom gateway host

In the direct subscriber baseline it is absent.  
In the trusted via-gateway side-channel baseline it is present as:

- `localhost:9443`

That is a direct signal that custom `ANTHROPIC_BASE_URL` is in use.  
It belongs in the transport-sensitive bucket, not the auth-model-sensitive bucket.

### 5. Subscriber tier fields are auth-model-sensitive

These fields are present in the direct subscriber baseline but absent in the managed-oauth via-gateway side-channel baseline:

- `attributes.subscriptionType`
- `attributes.rateLimitTier`
- `attributes.firstTokenTime`

This confirms the current client behavior:

- local Claude.ai subscriber flow exposes subscriber metadata
- `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed` is still treated as inference-only env-token auth for this surface

### 6. Top-level eval wrapper fields are currently inert

Across both baselines:

- `url` is the empty string
- `forcedVariations` is an empty object
- `forcedFeatures` is an empty array

These fields still belong in the matrix because they are easy places for future client changes to surface.

## Implications for the gateway

### Rewrite coverage

Current gateway coverage in [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts) already targets:

- `attributes.id`
- `attributes.deviceID`
- `attributes.platform`
- `attributes.email`
- `attributes.appVersion`
- `attributes.apiBaseUrlHost`
- top-level `url`

That coverage is correct as a future-proofing layer, but it is not sufficient as an active mitigation while `/api/eval/*` remains a direct-host side channel.

### Current mitigation

For the current shipping path, the real mitigation remains:

- `quiet mode` to suppress the surface
- or network-layer interception if we want to force ownership back under the gateway

### Maintenance value

This matrix is now the fixed asset that tells us:

- whether upstream added a new eval field
- whether a field moved between auth-sensitive and transport-sensitive buckets
- whether the surface changed owner and finally started traversing the gateway

## Update workflow

When Claude Code updates, rerun in this order:

1. recapture the direct subscriber baseline
2. recapture the trusted via-gateway side-channel baseline
3. rerun:
   ```powershell
   python mitm/summarize_eval_field_matrix.py --label <new-version> --format json
   ```
4. compare the new JSON with:
   [eval_field_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_field_matrix_2026-04-03.json)
5. if upstream added a field, update:
   [eval_attribute_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_attribute_targets.json)
6. append the conclusion to:
   [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

## Fast classification rules

When the matrix changes, classify it like this:

- new field only appears with custom base URL:
  `transport-sensitive`
- field disappears only in managed-oauth:
  `auth-model-sensitive`
- field value changes every request:
  `session-runtime`
- field is stable and account-linked across baselines:
  `stable-identity` or `account-scope`

This keeps `/api/eval/*` aligned with the same methodology used by:

- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
- [rapid-triage-playbook.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/rapid-triage-playbook.md)
