# 客户端模式

## 目的

这份文档把 gateway 客户端接入明确拆成两个正交维度：

1. `traffic mode`
2. `auth mode`

如果不先区分这两个维度，后面做抓包、遥测对齐、自动 diff 时会反复踩同一个坑：

- 生产上为了压低旁路流量而主动关闭的通道
- 会被误判成 gateway 没改写、CLI 没发、或者 MITM 没抓到
- 客户端接入模型自己改写了 subscriber/OAuth 叙事
- 会被误判成“官方又改了遥测”

## 维度一：traffic mode

### quiet mode

- 目的：
  给测试者和生产使用，尽量减少 first-party 旁路流量
- 关键开关：
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`

### alignment mode

- 目的：
  做 MITM 抓包、direct CLI 对照、最新遥测研究
- 关键要求：
  不设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`

## 维度二：auth mode

### managed-oauth

- 目的：
  让客户端保留 first-party OAuth / subscriber 叙事，同时把 gateway token 放到自定义头里
- 关键配置：
  - `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
  - `ANTHROPIC_CUSTOM_HEADERS=x-api-key: <gateway-client-token>`
- 结论：
  这是当前研究默认模式，也是后续对外接入的推荐默认值
- 重要边界：
  这条模式保留的是 first-party OAuth 叙事，不等于完整 local subscriber 会话。
  参考源码里，`CLAUDE_CODE_OAUTH_TOKEN` 会被视为 inference-only env token，`subscriptionType = null`，所以某些要求 `isConsumerSubscriber()` 的控制面不会再出现。
- remote-control 补充：
  这条模式也不能满足 bridge 的 full-scope login 要求；`claude remote-control` 会直接报 profile scope 错误

### external-auth-token

- 目的：
  把 gateway token 直接塞进 `ANTHROPIC_AUTH_TOKEN`
- 关键配置：
  - `ANTHROPIC_AUTH_TOKEN=<gateway-client-token>`
- 结论：
  这不是高保真接入模型，只适合专项实验
- 原因：
  参考源码里，`ANTHROPIC_AUTH_TOKEN` 会被视为 external auth token，`isAnthropicAuthEnabled()` 会因此返回 `false`
  这会直接改变：
  - `isClaudeAISubscriber()`
  - OAuth account 信息可见性
  - GrowthBook attributes
  - 一部分 first-party side channel 的触发条件
- remote-control 补充：
  这条模式下 `claude remote-control` 会直接报 `requires a claude.ai subscription`

## 组合一：quiet + managed-oauth

### 适用场景

- 给测试者直接使用 gateway
- 日常生产使用
- 希望尽量减少 first-party 旁路流量

### 关键配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "CLAUDE_CODE_OAUTH_TOKEN": "gateway-managed",
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: your-gateway-client-token",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "hasCompletedOnboarding": true
}
```

参考：

- [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)

### 结果

- 主推理流量走 gateway
- GrowthBook 不再发送
- 1P event logging 不再发送
- bootstrap、metrics opt-out、grove 等非必要控制面请求也会被压掉或收缩
- 客户端仍然保留 first-party OAuth / subscriber 叙事，不会因为接入模型本身切到外部 token 路径
- 但这不等于所有 subscriber-only 控制面都能保留。像 Grove 这类要求 consumer plan 的控制面，当前 via-gateway `managed-oauth` 仍会被 auth model 裁掉

### 结论

这是当前最适合对外分发的模式。

## 组合二：alignment + managed-oauth

### 适用场景

- 做 MITM 抓包
- 做 direct CLI 和 gateway 的差异对比
- 追踪最新遥测字段和 first-party 控制面变化

### 关键配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "CLAUDE_CODE_OAUTH_TOKEN": "gateway-managed",
    "ANTHROPIC_CUSTOM_HEADERS": "x-api-key: your-gateway-client-token"
  },
  "hasCompletedOnboarding": true
}
```

参考：

- [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)

### 结果

- 主推理流量仍会走 gateway
- GrowthBook 和 1P event logging 有资格重新出现
- 但它们不一定跟随 `ANTHROPIC_BASE_URL`
- 其中一部分会继续直指 `api.anthropic.com`
- trusted `via-gateway` 双通道里，`managed-oauth` 已重新抓到 `POST /api/eval/sdk-*`
- 但 Grove / account settings 这两条面当前不应按 “没抓到” 理解，而应按 auth-model-suppressed 理解

### 额外要求

`alignment mode` 必须配合系统代理或 MITM 才有意义。否则：

- 你只能看到走 gateway 的主链请求
- 看不到直连 `api.anthropic.com` 的 side channel
- 会把“没有抓到”误判成“没有发送”

## 组合三：alignment + external-auth-token

### 适用场景

- 专门验证“接入模型本身会让客户端行为面发生多大偏移”

### 关键配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "ANTHROPIC_AUTH_TOKEN": "your-gateway-client-token"
  },
  "hasCompletedOnboarding": true
}
```

### 结果

- 主推理流量仍然会走 gateway
- 但这条路径会把 CLI 切成 external auth token 叙事
- 当前实抓已经确认：
  - `managed-oauth` 下，trusted `via-gateway` 会重新出现 `/api/eval/sdk-*`
  - `external-auth-token` 下，同一工作流里 `/api/eval/*` 没有出现

### 结论

这条路径不能拿来当“CLI 高保真对齐”的基线。

## 源码依据

### quiet mode 会关闭 telemetry

- [privacyLevel.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/privacyLevel.ts)
- [analytics/config.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/config.ts)
- [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)

### auth mode 会改变 subscriber / OAuth 叙事

- [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
- [http.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/http.ts)
- [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
- [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- [grove-control-plane-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/grove-control-plane-gating.md)
- [remote-control-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/remote-control-gating.md)

### custom base URL 还会裁掉一部分 first-party 控制面

- [providers.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/model/providers.ts)
- [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)
- [remoteManagedSettings/syncCache.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/syncCache.ts)
- [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)

## 实际操作建议

### 对外给测试者

默认发 `quiet + managed-oauth`。

### 对内做研究

默认使用 `alignment + managed-oauth`，并且：

1. 让直连和 gateway 都走可控代理
2. 用 [capture-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-direct.ps1) 和 [capture-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-gateway.ps1) 采集
3. 采集结束后先停 `mitmdump`，再用 `extract_signals.py` / `diff_signals.py` 分析

## 维护规则

后续只要发现某个环境变量、某类登录方式、某个 entrypoint 会改变遥测面，就要先判断它属于：

- `traffic mode` 设计结果
- `auth mode` 设计结果
- 真正的 gateway 改写缺口

不要把这三类问题混在一起。
