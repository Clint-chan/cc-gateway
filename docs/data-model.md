# CC Gateway Fork Data Model

## Purpose

This document defines the core entities for the forked platform version of `cc-gateway`.

The goal is to replace the current single-file YAML mindset with an explicit domain model that supports:

- multiple Claude accounts
- multiple fingerprint profiles
- multiple outbound proxies
- multiple client machines
- policy-driven routing
- operator auditability

## Design Principles

- Treat gateway runtime data and control plane data as separate concerns.
- Make account, fingerprint, proxy, client, and policy first-class records.
- Keep secrets encrypted at rest and minimize raw secret exposure.
- Prefer stable identifiers over names in all internal relations.
- Preserve room for staged rollout: file-backed adapters can exist before full database adoption.

## Entity Overview

The first useful version of the platform should include these entities:

1. `OperatorUser`
2. `ClaudeAccount`
3. `FingerprintProfile`
4. `ProxyNode`
5. `ClientMachine`
6. `RoutingPolicy`
7. `CapacityProfile`
8. `DispatchJob`
9. `GatewaySession`
10. `AuditLog`
11. `HealthEvent`

## Common Fields

Most entities should share a common metadata shape:

- `id`: internal stable identifier
- `createdAt`
- `updatedAt`
- `createdBy`
- `updatedBy`
- `deletedAt` for soft delete where appropriate

Recommended identifier format:

- ULID or UUIDv7 for sortable unique IDs

## OperatorUser

Represents a human operator of the admin system.

### Fields

- `id`
- `username`
- `displayName`
- `email`
- `passwordHash` or external auth reference
- `role`
- `status`
- `lastLoginAt`

### Status

- `ACTIVE`
- `DISABLED`

### Role

- `SUPER_ADMIN`
- `ADMIN`
- `OPERATOR`
- `VIEWER`

### Notes

- This entity belongs to the control plane only.
- It must never be used as a runtime identity for gateway clients.

## ClaudeAccount

Represents one Claude account whose OAuth credentials can be used by the gateway.

### Fields

- `id`
- `name`
- `status`
- `email`
- `deviceId`
- `refreshTokenEncrypted`
- `accessTokenEncrypted`
- `accessTokenExpiresAt`
- `fingerprintProfileId`
- `defaultProxyId`
- `defaultPolicyId`
- `capacityProfileId`
- `regionHint`
- `tags`
- `notes`
- `lastRefreshAt`
- `lastRefreshError`
- `quotaState`
- `busyState`
- `drainState`
- `rollingWindowUtilization`
- `rollingWindowResetsAt`
- `weeklyBudgetState`
- `weeklyBudgetResetsAt`
- `lastRetryAfterSeconds`
- `cooldownUntil`
- `concurrencyLimit`
- `maxActiveSessions`
- `priorityWeight`

### Status

- `ACTIVE`
- `PAUSED`
- `COOLDOWN`
- `UNHEALTHY`
- `DISABLED`
- `ARCHIVED`

### Quota State

- `NORMAL`
- `LIMITED`
- `EXHAUSTED`
- `UNKNOWN`

### Busy State

- `IDLE`
- `BUSY`

### Drain State

- `ACCEPTING`
- `DRAINING`
- `DRAINED`

### Notes

- `deviceId` should be stable for that account unless intentionally rotated.
- `fingerprintProfileId` defines the default profile used when rewriting requests for this account.
- `defaultProxyId` is optional because policy-based routing may override it.
- `refreshTokenEncrypted` is mandatory for accounts used in automatic refresh flows.
- one shared account should still present one stable outward fingerprint and proxy story to the upstream.
- `capacityProfileId` lets the scheduler separate account-class behavior from fingerprint behavior.

## FingerprintProfile

Represents a reusable machine identity template.

### Fields

- `id`
- `name`
- `status`
- `platform`
- `platformRaw`
- `arch`
- `nodeVersion`
- `terminal`
- `packageManagers`
- `runtimes`
- `isRunningWithBun`
- `isCi`
- `isClaudeAiAuth`
- `claudeVersion`
- `claudeVersionBase`
- `buildTime`
- `deploymentEnvironment`
- `vcs`
- `promptPlatform`
- `promptShell`
- `promptOsVersion`
- `promptWorkingDir`
- `constrainedMemory`
- `rssMin`
- `rssMax`
- `heapTotalMin`
- `heapTotalMax`
- `heapUsedMin`
- `heapUsedMax`
- `userAgentTemplate`
- `billingHeaderTemplate`
- `tags`
- `notes`

### Status

- `ACTIVE`
- `DISABLED`
- `ARCHIVED`

### Notes

- This entity replaces the current `identity`, `env`, `prompt_env`, and `process` fragments as a structured object.
- A profile should be internally coherent. Version strings, prompt values, and process metrics should all describe the same plausible machine.

## ProxyNode

Represents one outbound proxy endpoint available to the gateway.

### Fields

- `id`
- `name`
- `status`
- `type`
- `provider`
- `region`
- `city`
- `networkType`
- `endpointHost`
- `endpointPort`
- `usernameEncrypted`
- `passwordEncrypted`
- `protocol`
- `supportsTls`
- `tags`
- `notes`
- `lastHealthCheckAt`
- `lastHealthStatus`
- `lastHealthError`
- `latencyMs`
- `successRate`
- `failureCount`
- `cooldownUntil`

### Status

- `ACTIVE`
- `PAUSED`
- `COOLDOWN`
- `UNHEALTHY`
- `DISABLED`
- `ARCHIVED`

### Type

- `HTTP`
- `HTTPS`
- `SOCKS5`

### Network Type

- `RESIDENTIAL`
- `ISP`
- `DATACENTER`
- `MOBILE`
- `UNKNOWN`

### Notes

- `protocol` defines how the gateway reaches the proxy.
- `networkType` is an operator-facing classification used in routing policy.
- Credentials should be encrypted at rest.
- later versions should support exclusive or sticky assignment between accounts and proxies.

## ClientMachine

Represents one upstream caller that is allowed to use the gateway.

### Fields

- `id`
- `name`
- `status`
- `tokenHash`
- `tokenPreview`
- `defaultPolicyId`
- `allowedPolicyIds`
- `allowedAccountIds`
- `sourceIpAllowlist`
- `tags`
- `notes`
- `lastSeenAt`
- `lastSeenIp`
- `lastSeenUserAgent`

### Status

- `ACTIVE`
- `PAUSED`
- `DISABLED`
- `ARCHIVED`

### Notes

- Store `tokenHash`, not the raw token, after initial creation.
- `tokenPreview` can keep only a short prefix for UI recognition.
- `sourceIpAllowlist` is optional but useful if you later want stricter gateway authentication.

## RoutingPolicy

Represents a declarative routing rule for deciding which account and proxy should serve a request.

### Fields

- `id`
- `name`
- `status`
- `priority`
- `matchMode`
- `clientMachineIds`
- `clientTags`
- `pathPatterns`
- `headerMatches`
- `accountSelectionStrategy`
- `accountPool`
- `proxySelectionStrategy`
- `proxyPool`
- `fallbackStrategy`
- `concurrencyLimit`
- `cooldownSeconds`
- `sessionAffinityMode`
- `queueStrategy`
- `budgetGuardrail`
- `peakHourStrategy`
- `notes`

### Status

- `ACTIVE`
- `PAUSED`
- `DISABLED`
- `ARCHIVED`

### Match Mode

- `FIRST_MATCH`
- `ALL_MATCH`

### Account Selection Strategy

- `FIXED`
- `ROUND_ROBIN`
- `LEAST_LOADED`
- `BUDGET_AWARE`
- `WEIGHTED_RANDOM`
- `FAILOVER`

### Proxy Selection Strategy

- `NONE`
- `FIXED`
- `ROUND_ROBIN`
- `LEAST_LATENCY`
- `STICKY_ACCOUNT`
- `WEIGHTED_RANDOM`
- `FAILOVER`

### Fallback Strategy

- `FAIL_REQUEST`
- `TRY_NEXT_ACCOUNT`
- `TRY_NEXT_PROXY`
- `TRY_NEXT_ACCOUNT_AND_PROXY`

### Notes

- `accountPool` and `proxyPool` can start as arrays of IDs and evolve later into richer rule objects.
- `priority` should determine evaluation order when multiple active policies match.
- `sessionAffinityMode` is required once multi-turn conversations must stay on the same account.
- `budgetGuardrail` and `peakHourStrategy` are where scheduler policy can react to rate-limit headers and time-of-day pressure.

## CapacityProfile

Represents scheduler behavior that belongs to an account class, not to one specific account or one fingerprint asset.

### Fields

- `id`
- `name`
- `status`
- `accountClass`
- `maxActiveSessions`
- `rollingWindowBudgetHint`
- `weeklyBudgetHint`
- `peakHourMultiplier`
- `retryBackoffPolicy`
- `drainThreshold`
- `queuePriority`
- `notes`

### Status

- `ACTIVE`
- `DISABLED`
- `ARCHIVED`

### Notes

- Use this entity to encode capacity behavior such as peak-hour down-weighting or conservative drain thresholds.
- Do not store account-specific secrets or fingerprint data here.

## DispatchJob

Represents queued work waiting for a safe account/proxy assignment.

### Fields

- `id`
- `status`
- `routingPolicyId`
- `clientMachineId`
- `sessionAffinityKey`
- `requestPath`
- `priority`
- `queuedAt`
- `startedAt`
- `finishedAt`
- `attemptCount`
- `nextAttemptAt`
- `lastErrorCode`
- `lastErrorMessage`

### Status

- `QUEUED`
- `RUNNING`
- `RETRY_WAIT`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

### Notes

- This entity becomes important once the scheduler prefers queueing over unsafe overload.
- `sessionAffinityKey` lets retries preserve cache-aware routing when possible.

## GatewaySession

Represents a runtime association between a client request stream and the resources selected for it.

### Fields

- `id`
- `clientMachineId`
- `routingPolicyId`
- `claudeAccountId`
- `fingerprintProfileId`
- `proxyNodeId`
- `dispatchJobId`
- `sessionAffinityKey`
- `requestPath`
- `startedAt`
- `endedAt`
- `status`
- `requestCount`
- `queueWaitMs`
- `retryCount`
- `errorCode`
- `errorMessage`

### Status

- `OPEN`
- `COMPLETED`
- `FAILED`
- `CANCELLED`

### Notes

- This entity is useful for debugging which account and proxy were used by a request stream.
- It is especially important once dynamic routing is introduced.
- `sessionAffinityKey` should explain why follow-up turns stayed on the same account.

## AuditLog

Represents control plane changes and sensitive gateway actions.

### Fields

- `id`
- `actorType`
- `actorId`
- `action`
- `targetType`
- `targetId`
- `summary`
- `detailsJson`
- `ipAddress`
- `userAgent`
- `createdAt`

### Actor Type

- `OPERATOR`
- `SYSTEM`
- `CLIENT_MACHINE`

### Notes

- Log account creation, proxy updates, policy changes, token rotation, and manual state changes.
- Avoid writing raw secrets into `detailsJson`.

## HealthEvent

Represents a point-in-time health result for an account or proxy.

### Fields

- `id`
- `targetType`
- `targetId`
- `status`
- `reason`
- `detailsJson`
- `utilizationSnapshot`
- `retryAfterSeconds`
- `latencyMs`
- `createdAt`

### Target Type

- `CLAUDE_ACCOUNT`
- `PROXY_NODE`
- `GATEWAY_RUNTIME`

### Status

- `HEALTHY`
- `DEGRADED`
- `UNHEALTHY`

## Key Relationships

The main relationships are:

- one `ClaudeAccount` references one default `FingerprintProfile`
- one `ClaudeAccount` may reference one default `ProxyNode`
- one `ClaudeAccount` may reference one `CapacityProfile`
- one `ClientMachine` may reference one default `RoutingPolicy`
- one `RoutingPolicy` may reference many `ClaudeAccount` records
- one `RoutingPolicy` may reference many `ProxyNode` records
- one `DispatchJob` may be assigned to one `GatewaySession`
- one `GatewaySession` references one client, one policy, one account, one fingerprint profile, and optionally one proxy

## Secret Storage Rules

The following fields should be treated as secrets:

- `ClaudeAccount.refreshTokenEncrypted`
- `ClaudeAccount.accessTokenEncrypted`
- `ProxyNode.usernameEncrypted`
- `ProxyNode.passwordEncrypted`
- raw client bearer tokens before hashing

Rules:

- encrypt secrets at rest
- never return secrets in list APIs
- reveal full secret material only at create time if needed
- redact secrets from logs and audit payloads

## Suggested Database Tables

Recommended initial tables:

- `operator_users`
- `claude_accounts`
- `fingerprint_profiles`
- `proxy_nodes`
- `client_machines`
- `capacity_profiles`
- `routing_policies`
- `routing_policy_accounts`
- `routing_policy_proxies`
- `dispatch_jobs`
- `gateway_sessions`
- `audit_logs`
- `health_events`

## Initial Validation Rules

The first backend version should validate at least the following:

- `ClaudeAccount.email` must be present for active accounts
- `ClaudeAccount.refreshTokenEncrypted` must exist for active accounts using managed OAuth
- `FingerprintProfile.promptPlatform` must match `platform`
- `rssMin <= rssMax`
- `heapTotalMin <= heapTotalMax`
- `heapUsedMin <= heapUsedMax`
- `ProxyNode.endpointHost` and `endpointPort` must both exist for active proxies
- `ClientMachine.tokenHash` must exist for active clients
- `RoutingPolicy.priority` must be unique or deterministically sortable
- `ClaudeAccount.maxActiveSessions` must be greater than zero for routable accounts
- `ClaudeAccount.defaultProxyId` should resolve to an active proxy when strict proxy isolation is enabled
- `CapacityProfile.rollingWindowBudgetHint` must be positive when budget-aware scheduling is enabled

## Migration Mapping From Current YAML

The current `config.yaml` can be mapped into the future model like this:

- `oauth.refresh_token` -> one `ClaudeAccount.refreshTokenEncrypted`
- `identity.device_id` + `identity.email` -> account identity fields
- `fingerprint_profile` or inline `client/env/prompt_env/process` -> one `FingerprintProfile`
- `auth.tokens[]` -> multiple `ClientMachine` records
- global upstream config -> runtime or system config table later

This mapping means you can migrate incrementally without breaking the gateway behavior on day one.
