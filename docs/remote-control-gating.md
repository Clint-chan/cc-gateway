# Remote Control gating

## 目的

这份文档专门冻结 `claude remote-control` 这条命令为什么会“很早就结束”。

它不是 `/api/eval/*` 的通用文档，而是 bridge entitlement 的单独说明。

如果不把这条命令和普通 telemetry probe 分开，后面很容易把三件不同的事混在一起：

1. bridge auth / subscriber 条件不成立
2. bridge profile scope 或 organization 上下文不成立
3. 真正的 `tengu_ccr_bridge` feature gate 为 false

## 真实命令路径

参考源码在 [cli.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/entrypoints/cli.tsx)：

- `claude remote-control`
- `claude rc`
- `claude remote`
- `claude sync`
- `claude bridge`

都会进入 bridge fast-path。

也就是说：

- `claude remote-control` 确实是官方的 standalone bridge 入口
- 不是普通 prompt，也不是错误命令路径

## gating 顺序

当前版本的 gating 顺序已经很清楚了。

### 第 1 层：必须先有 OAuth access token

在 [cli.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/entrypoints/cli.tsx) 里，bridge fast-path 会先检查：

- `getClaudeAIOAuthTokens()?.accessToken`

如果没有 token，会直接报登录错误。

### 第 2 层：`getBridgeDisabledReason()`

在 [bridgeEnabled.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/bridge/bridgeEnabled.ts) 里，这一步会按顺序检查：

1. `isClaudeAISubscriber()`
2. `hasProfileScope()`
3. `getOauthAccountInfo()?.organizationUuid`
4. `checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge')`

只要其中任何一步不通过，命令就会直接结束，并给出明确错误文本。

### 第 3 层：bridge 最低版本

如果前面的 entitlement 都过了，才会继续检查：

- `checkBridgeMinVersion()`

### 第 4 层：组织 policy

最后才会检查：

- `allow_remote_control`

也就是说：

> 大多数 `remote-control` 的失败，都发生在真正进入 bridgeMain 之前。

## 当前实测结果

这轮我直接在本机跑了三种身份模型，结果已经可以冻结。

### 1. 本地 Claude.ai subscriber 会话

命令：

```powershell
claude remote-control
```

结果：

```text
Error: Remote Control is not yet enabled for your account.
```

解释：

- 当前本地会话有：
  - Claude.ai OAuth token
  - `user:profile`
  - `organizationUuid`
  - `subscriptionType = max`
- 但当前 bridge gate 仍然是 false

所以：

- 这不是代理问题
- 也不是 auth 缺失
- 而是 bridge entitlement 本身没有给这个账号

### 2. via-gateway `managed-oauth`

环境：

- `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
- `ANTHROPIC_CUSTOM_HEADERS=x-api-key: ...`

结果：

```text
Error: Remote Control requires a full-scope login token. Long-lived tokens (from `claude setup-token` or CLAUDE_CODE_OAUTH_TOKEN) are limited to inference-only for security reasons. Run `claude auth login` to use Remote Control.
```

解释：

- 这条模式下客户端把 `CLAUDE_CODE_OAUTH_TOKEN` 视为 inference-only env token
- `scopes = ['user:inference']`
- `hasProfileScope() = false`

所以：

- 命令会在 profile scope 这一层直接失败
- 甚至还没走到真正的 bridge entitlement gate

### 3. via-gateway `external-auth-token`

环境：

- `ANTHROPIC_AUTH_TOKEN=<gateway-client-token>`

结果：

```text
Error: Remote Control requires a claude.ai subscription. Run `claude auth login` to sign in with your claude.ai account.
```

解释：

- 这条模式下客户端走 external auth token 路径
- `isClaudeAISubscriber() = false`

所以：

- 命令会在 subscriber 检查这一层直接失败

## 当前冻结结论

### 结论一：`remote-control` 不是通用 `/api/eval/*` probe

它是 bridge entitlement probe。

如果当前 auth model、profile scope、organization、feature gate 任一不满足，它会很早结束。

所以：

- 不能继续把 `remote-control` 是否发出 `/api/eval/*` 当成“GrowthBook 有没有工作”的通用判断

### 结论二：via-gateway 两种 auth mode 都天然不适合做 bridge 研究

- `managed-oauth`
  卡在 `hasProfileScope()`
- `external-auth-token`
  卡在 `isClaudeAISubscriber()`

所以：

- 如果要研究 bridge/remote-control
- 应该优先用本地真实 `claude auth login` 会话

### 结论三：当前本地账号的 direct `remote-control` 是 gate-disabled，不是链路失败

当前 direct subscriber 会话下的错误文本已经说明：

- 账号没有拿到 `tengu_ccr_bridge`

所以：

- 后面不用再把这个命令当“代理没接上”的怀疑对象

## 快速检查

先运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-auth-gating-state.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-bridge-gating-state.ps1
```

这样可以先知道：

- 当前到底是哪种 auth model
- 有没有 profile scope
- 有没有 organizationUuid
- bridge gate 当前缓存值是什么

## 推荐用法

### 要研究 `/api/eval/*`

优先用：

- trusted direct `headless-hello`
- trusted via-gateway `headless-hello`

不要优先用 `remote-control`。

### 要研究 bridge entitlement

才用：

- `claude remote-control`

而且先跑 bridge gating 检查，再解释错误文本。

## 关联文档

- [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)
- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
