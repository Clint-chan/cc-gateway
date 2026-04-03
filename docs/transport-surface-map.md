# 传输面地图

## 目的

这份文档回答一个比“字段怎么改写”更前置的问题：

> 某条请求到底归谁管？

也就是：

1. 它会不会跟着 `ANTHROPIC_BASE_URL` 走 gateway
2. 它会不会直接打向 `api.anthropic.com`
3. 它是不是会被 `quiet mode` 或 `custom base URL` 直接裁掉

如果这个问题没先搞清楚，后面的抓包 diff 会反复把三种完全不同的现象混在一起：

- gateway 没改写
- 请求本来就旁路
- 请求本来就不该发

## 分类规则

### A. gateway 主链

这类请求正常情况下会跟着 Claude Code 的 API 客户端走，研究 gateway 改写时优先看它们。

### B. direct-host side channel

这类请求不依赖 `ANTHROPIC_BASE_URL`，默认会直接打 first-party 端点。

如果不用系统代理或 MITM，就看不到它们。

### C. gated surface

这类请求是否发送，先取决于：

- `quiet mode`
- `custom base URL`
- 特定 feature gate
- 交互/非交互模式

所以看到“没发出来”时，不能先怪 gateway。

## 当前地图

### 1. gateway 主链

#### 1.1 `/v1/messages`

- 归属：
  gateway 主链
- 依据：
  [client.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/client.ts)
- 备注：
  当前我们已经把这一条主链基本对齐干净

#### 1.2 Files API

- 归属：
  gateway 主链
- 依据：
  [filesApi.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/filesApi.ts)
- 备注：
  `getDefaultApiBaseUrl()` 会优先使用：
  - `ANTHROPIC_BASE_URL`
  - `CLAUDE_CODE_API_BASE_URL`
  - 然后才回退 `https://api.anthropic.com`

#### 1.3 API preconnect

- 归属：
  gateway 主链
- 依据：
  [apiPreconnect.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/apiPreconnect.ts)
- 备注：
  预连接会优先使用 `ANTHROPIC_BASE_URL`

### 2. direct-host side channel

#### 2.1 GrowthBook remote eval

- 归属：
  direct-host side channel
- 依据：
  [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- 当前形态：
  默认 `apiHost` 是 `https://api.anthropic.com/`
- 备注：
  这意味着就算主推理流量走 gateway，GrowthBook 也未必会走同一路
  另外还要区分两个前置条件：
  - headless `-p` 路径只会 fire-and-forget 初始化 GrowthBook，进程可能先退出
  - local-jsx / interactive 命令如果当前 cwd 没 trust，GrowthBook 可能连 auth headers 都拿不到
  详见 [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- 最新实抓：
  在 trusted capture workspace 下，`claude -p "hello"` 已经明确抓到 `POST /api/eval/sdk-*`
- 当前判断：
  `/api/eval/*` 仍然是活的 direct-host side channel；默认 cwd 抓不到，不代表它不存在
- 当前 via-gateway 补充结论：
  在 trusted workspace + custom base URL 的双通道最小请求里：
  - `managed-oauth` 会重新出现 `/api/eval/sdk-*`
  - `external-auth-token` 不会出现 `/api/eval/*`
- 备注：
  这说明 `/api/eval/*` 不只是受 traffic mode 和时序影响，也受 auth mode 影响

#### 2.2 1P event logging

- 归属：
  direct-host side channel
- 依据：
  [firstPartyEventLoggingExporter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLoggingExporter.ts)
- 当前形态：
  默认 `baseUrl` 是 `https://api.anthropic.com`
- 备注：
  只有 `quiet mode` 关闭它，或者额外网络层代理接管它
- 最新实抓：
  在 `alignment mode + custom base URL + headless` 的当前最小请求里，这一路仍然会发，而且会绕过 gateway，直接暴露真实本机环境
- 当前 via-gateway 补充结论：
  在 trusted workspace + custom base URL 的双通道最小请求里：
  - `managed-oauth + RepeatCount=2` 目前已确认属于 delay-sensitive 命中区间
  - `managed-oauth + RepeatCount=3` 是当前跨 `0 / 250 / 1000ms` 都成立的稳定下界
  - 仍然是 direct side-channel，不经过 gateway 上游
- 备注：
  说明它至少还受 mode 和 probe 时序影响；不能因为单轮缺失就把它从风险面移除
  详细阈值矩阵看：
  - [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)

#### 2.3 metrics opt-out

- 归属：
  direct-host side channel
- 依据：
  [metricsOptOut.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/metricsOptOut.ts)
- 当前形态：
  直接写死 `https://api.anthropic.com/api/claude_code/organizations/metrics_enabled`

#### 2.4 official MCP registry

- 归属：
  direct-host side channel
- 依据：
  [officialRegistry.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/mcp/officialRegistry.ts)
- 当前形态：
  直接写死 `https://api.anthropic.com/mcp-registry/...`

### 3. `BASE_API_URL` 控制面

这类请求虽然不是 `ANTHROPIC_BASE_URL` 主链，但也不一定都“写死”。

它们走的是 [oauth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/oauth.ts) 里的 `getOauthConfig().BASE_API_URL`。

在正常 prod 环境下，这个值就是 `https://api.anthropic.com`。

#### 3.1 bootstrap

- 依据：
  [bootstrap.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/bootstrap.ts)
- 最新实抓：
  trusted capture workspace 下的 `claude -p "hello"` 已抓到 `GET /api/claude_cli/bootstrap`
  在 trusted `via-gateway` 双通道中，这一路仍以 direct side channel 形态出现

#### 3.2 grove 与账户设置

- 依据：
  [grove.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/grove.ts)
- 最新实抓：
  trusted capture workspace 下的 `claude -p "hello"` 已抓到：
  - `GET /api/claude_code_grove`
  - `GET /api/oauth/account/settings`
  当前 via-gateway 双通道最小请求里，这两条不会按普通 side channel 逻辑出现
- 当前结论：
  当前 via-gateway 的两种 auth mode 都会先把 Grove consumer-subscriber gating 裁掉，因此这两条面应归为：
  - `gated-surface`
  - `auth-mode-sensitive`
  - 当前状态：`auth-model-suppressed`
- 备注：
  这两条面不是简单的 “not-observed”。
  详细说明看：
  - [grove-control-plane-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/grove-control-plane-gating.md)

#### 3.3 usage / referral / overage credit grant / admin requests

- 依据：
  - [usage.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/usage.ts)
  - [referral.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/referral.ts)
  - [overageCreditGrant.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/overageCreditGrant.ts)
  - [adminRequests.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/adminRequests.ts)

#### 3.4 policy limits / remote managed settings / settings sync / team memory sync

- 依据：
  - [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)
  - [remoteManagedSettings/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/index.ts)
  - [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)
  - [teamMemorySync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/teamMemorySync/index.ts)

#### 3.5 fast mode / penguin mode / ultrareview / session ingress

- 依据：
  - [fastMode.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/fastMode.ts)
  - [ultrareviewQuota.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/ultrareviewQuota.ts)
  - [sessionIngress.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/sessionIngress.ts)
- 最新实抓：
  trusted `via-gateway` 双通道里已抓到：
  - `GET /api/claude_code_penguin_mode`
- 备注：
  本轮它仍以 direct side-channel 形态出现，不经过 gateway 上游

#### 3.6 MCP 控制面

- 依据：
  - [officialRegistry.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/mcp/officialRegistry.ts)
- 最新实抓：
  trusted capture workspace 下的 `claude -p "hello"` 已抓到：
  - `GET /v1/mcp_servers?limit=1000`
  - `GET /mcp-registry/v0/servers?version=latest&visibility=commercial`
- 备注：
  这说明即使是最小 headless 请求，MCP 相关控制面也可能被带起来
  在 trusted `via-gateway` 双通道里，这两条仍然以 direct side-channel 形态出现，不经过 gateway 上游

## 两层 gating

### quiet mode gating

如果设置了：

```text
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
```

则一批 side channel 会被客户端直接压掉。

参考：

- [privacyLevel.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/privacyLevel.ts)
- [analytics/config.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/config.ts)

### custom base URL gating

如果设置了自定义 `ANTHROPIC_BASE_URL`，一批 only-first-party 控制面功能会直接失去资格。

参考：

- [providers.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/model/providers.ts)
- [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)
- [remoteManagedSettings/syncCache.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/syncCache.ts)
- [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)

### auth model gating

如果客户端使用不同的 auth mode，同一条 custom base URL 路径也可能表现出完全不同的行为面。

参考：

- [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
- [http.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/http.ts)
- [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
- [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)

当前已确认：

- `ANTHROPIC_AUTH_TOKEN` 会被官方客户端视为 external auth token
- 这会让 `isAnthropicAuthEnabled()` 返回 `false`
- 从而改变：
  - `isClaudeAISubscriber()`
  - OAuth account 信息可见性
  - GrowthBook attributes
  - 一部分 first-party side channel 触发条件
- `CLAUDE_CODE_OAUTH_TOKEN + ANTHROPIC_CUSTOM_HEADERS=x-api-key: ...` 则更接近 first-party subscriber/OAuth 叙事
- 但要注意：
  `CLAUDE_CODE_OAUTH_TOKEN` 在客户端内部仍然会被视为 inference-only env token，`subscriptionType = null`。
  所以它不是完整的 local subscriber 会话，像 Grove 这类要求 `isConsumerSubscriber()` 的控制面仍会被 auth model 裁掉。
- 同样地：
  `claude remote-control` 也会在更早的 bridge gating 链里被裁掉：
  - `managed-oauth` 卡在 full-scope login 要求
  - `external-auth-token` 卡在 claude.ai subscription 要求

auth-mode-sensitive 的具体控制面矩阵，统一看：

- [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
- [remote-control-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/remote-control-gating.md)

## 对我们项目的含义

### 如果目标是实际使用

优先用 `quiet + managed-oauth`。

这时真正要保住的是：

- `/v1/messages`
- Files API
- 以及 gateway 主链上的 persona 一致性

如果不开 `quiet mode`，当前已确认 `1P event logging` 仍会旁路直连并带出真实本机指纹。

### 如果目标是研究最新 first-party 遥测

必须用 `alignment + managed-oauth`，并额外控制：

- 系统代理
- MITM
- capture 脚本

否则你根本看不到那些默认旁路的 side channel。

## 维护规则

后续只要出现一个新 endpoint，就先给它打上这三个标签：

1. `gateway-mainline`
2. `direct-host-side-channel`
3. `gated-surface`

然后再补两个上下文标签：

4. `traffic-mode-sensitive`
5. `auth-mode-sensitive`

只有先归类，后面的 diff 和改写策略才不会乱。
