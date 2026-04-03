# Grove 控制面 gating

## 目的

这份文档专门冻结一个很容易被误判的问题：

> 为什么 trusted direct 抓包里能看到 `/api/claude_code_grove` 和 `/api/oauth/account/settings`，但 trusted via-gateway 的 `managed-oauth` / `external-auth-token` 路径里经常完全看不到。

这不是单纯的“抓包没抓到”，也不只是 “groveConfigCache 还很新”。

当前结论已经足够明确：在我们现在采用的 via-gateway 客户端接入模型下，这两条 Grove 控制面首先会被 auth model 裁掉。

## 核心证据

### 1. `CLAUDE_CODE_OAUTH_TOKEN` 是 inference-only token

参考源码在 [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts) 里明确写了：

- 只要设置了 `CLAUDE_CODE_OAUTH_TOKEN`
- `getClaudeAIOAuthTokens()` 就直接返回：
  - `scopes = ['user:inference']`
  - `subscriptionType = null`
  - `rateLimitTier = null`

这不是我们推测出来的行为，而是客户端自己的 auth 模型。

### 2. Grove 要求 `isConsumerSubscriber()`

同一份 [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts) 里：

- `isConsumerSubscriber()` 要求：
  - `isClaudeAISubscriber() = true`
  - `subscriptionType !== null`
  - `subscriptionType in { max, pro }`

也就是说：

- 只要 `subscriptionType = null`
- Grove 就不会把你当作 consumer subscriber

### 3. `external-auth-token` 更早就离开了 subscriber 路径

同样在 [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)：

- 如果客户端直接设置 `ANTHROPIC_AUTH_TOKEN`
- auth source 会切到 external auth token 路径
- Claude.ai subscriber 叙事不再成立

所以：

- `external-auth-token` 不是 “另一种 subscriber 写法”
- 而是完全不同的客户端 auth 身份

### 4. Grove 资格检查先于 Grove 控制面请求

参考源码在 [grove.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/grove.ts) 和 [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)：

- `claude -p "hello"` headless 路径先调用 `isQualifiedForGrove()`
- 只有在资格成立时，才会进入 `checkGroveForNonInteractive()`
- 后者才真正触发：
  - `GET /api/oauth/account/settings`
  - `GET /api/claude_code_grove`

这意味着：

- 如果 auth model 先让 `isQualifiedForGrove()` 走不通
- 后面的 Grove 控制面请求根本不会发

## 当前冻结结论

### 结论一：via-gateway `managed-oauth` 不是“完整 subscriber 会话”

虽然这条模式仍然走 Claude.ai auth 语义，但客户端侧看到的是：

- `CLAUDE_CODE_OAUTH_TOKEN`
- inference-only token
- `subscriptionType = null`

所以：

- 它可以保留部分 first-party OAuth / telemetry 叙事
- 但不能满足 Grove 的 consumer subscriber gating

### 结论二：via-gateway `external-auth-token` 也不会进入 Grove 路径

这条路径更直接：

- 客户端被带到 external auth token 叙事
- subscriber gating 不成立

所以：

- Grove / account settings 在这条模式下缺失，不应再被记成 “未观测”
- 应记成 auth-model-suppressed

### 结论三：`groveConfigCache` 只解释 direct local-subscriber 场景，不解释 via-gateway 抑制

本轮验证已经说明：

1. 清掉 [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json) 的 `groveConfigCache`
2. 再跑 trusted via-gateway `managed-oauth`
3. 仍然没有重新出现 Grove 控制面请求
4. 运行后本地也没有重新写回 `groveConfigCache`

这说明：

- 缓存只是一层影响因素
- 不是当前 via-gateway 缺失 Grove 的根因

## 对项目的实际帮助

这个结论的重要性不在“又抓到两个 endpoint”，而在于它让我们以后不再在错误层级上浪费时间。

现在遇到 Grove 控制面缺失时，先判断：

1. 当前是不是 `external-auth-token`
2. 当前是不是 `managed-oauth` env token
3. 当前有没有真正的本地 Claude.ai subscriber 会话
4. 当前 `subscriptionType` 是否还能成立

而不是一上来就：

- 怀疑系统代理没带上
- 怀疑 MITM 没接住
- 怀疑 capture workflow 又坏了

## 推荐检查流程

### 1. 先看 auth gating

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-auth-gating-state.ps1
```

重点看：

- `effective_auth_mode`
- `effective_subscription_type`
- `is_consumer_subscriber`
- `expected_grove_state`

### 2. 只有在 `expected_grove_state = eligible` 时，才继续追 Grove 请求

这时再看：

- trusted direct capture
- `groveConfigCache`
- cold-cache / warm-cache 行为

### 3. 如果只是想强制重现 Grove 面，先清缓存

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\clear-grove-cache.ps1
```

这个脚本会：

- 先备份 [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json)
- 再清理当前账号的 `groveConfigCache`

注意：

- 这只对 local subscriber direct 研究有意义
- 对 via-gateway `managed-oauth` / `external-auth-token` 本身的 auth suppression 不构成修复

## 对矩阵的影响

从现在开始，trusted via-gateway 矩阵里的这两行应该这样理解：

- `/api/oauth/account/settings`
- `/api/claude_code_grove`

当前 via-gateway 两种 auth mode 下都不是简单的 `not-observed`，而是：

- `auth-model-suppressed`

这意味着：

- 缺失是客户端 auth 身份模型的预期结果
- 不是 gateway rewrite 漏改
- 也不是当前 probe 本身无效

## 关联文档

- [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
- [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
- [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
