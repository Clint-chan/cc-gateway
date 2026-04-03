# 抓包对齐日志

## 目的

这份文档是 `cc-gateway` 的单一对齐记录。

每次处理一个“不对齐项”，都必须在这里追加一条记录，避免后续只看到代码结果，却看不到：

- 证据来自哪份抓包或参考源码
- 当前实现和真实 Claude Code 的差异是什么
- 已经做了什么修正
- 用什么方式回归验证
- 还剩下哪些未覆盖的风险

## 记录格式

每条记录按以下结构追加：

1. 编号
2. 日期
3. 证据
4. 当前差异
5. 处理动作
6. 回归验证
7. 剩余风险

## 对齐记录

### A-001 显式代理链路

- 日期：2026-04-03
- 证据：
  - [direct-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct-debug.txt)
  - [via-gateway-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/via-gateway-debug.txt)
- 当前差异：
  - 用户手工在 PowerShell 中运行 `claude -p "hello"` 能成功。
  - 自动化启动的 gateway 和测试进程没有稳定继承 `10808` 代理，因此会直连上游并触发 `403 Request not allowed`。
- 处理动作：
  - 为 gateway 增加显式 `network.proxy_url` 配置。
  - OAuth 刷新和上游 API 请求统一走 `HttpsProxyAgent`。
- 回归验证：
  - 本机 direct CLI 成功。
  - gateway 启动后 `/_health` 返回 `oauth: valid`。
- 剩余风险：
  - Docker 场景尚未重新验证容器网络到本机代理的可达性。

### A-002 客户端网关鉴权头

- 日期：2026-04-03
- 证据：
  - [via-gateway-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/via-gateway-debug.txt)
  - [via-gateway-xapikey-debug.txt](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/via-gateway-xapikey-debug.txt)
- 当前差异：
  - 旧 README 使用 `Proxy-Authorization` 作为 gateway 鉴权头。
  - 在本机代理链存在时，Claude Code 自身会把这个头当作代理层保留头，直接在客户端侧报错。
- 处理动作：
  - gateway 优先接受 `x-api-key`。
  - 文档和测试方式统一改为 `x-api-key`。
- 回归验证：
  - 使用 `ANTHROPIC_CUSTOM_HEADERS='x-api-key: ...'` 后，`claude -p "hello"` 可通过 gateway 成功。
- 剩余风险：
  - 仍需补充多客户端分发和 token 轮换策略。

### A-003 GrowthBook 评估请求体

- 日期：2026-04-03
- 证据：
  - [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  - `reference/claudecode_source/src/services/analytics/growthbook.ts`
- 当前差异：
  - 真实 CLI 会发送 `/api/eval/sdk-*` 请求。
  - 该请求体里带有 `id`、`deviceID`、`platform`、`email`、`appVersion` 等标识字段。
  - gateway 早期实现没有覆盖这一路。
- 处理动作：
  - 新增 `/api/eval/*` 请求体重写。
  - 统一 `attributes.id`、`attributes.deviceID`、`attributes.platform`、`attributes.email`、`attributes.appVersion`。
  - 删除 `attributes.apiBaseUrlHost`，清空顶层 `url`。
- 回归验证：
  - 代码已实现，待下一轮 MITM 复抓验证 gateway 上游实际出站体。
- 剩余风险：
  - `sessionId`、`organizationUUID`、`accountUUID`、`subscriptionType`、`rateLimitTier` 仍然透传。

### A-004 User-Agent 形态

- 日期：2026-04-03
- 证据：
  - [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  - [client.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/client.ts)
  - [main.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/main.tsx)
- 当前差异：
  - 真实 first-party 请求中，`/v1/messages` 抓到的 `User-Agent` 是 `claude-cli/2.1.91 (external, sdk-cli)`。
  - gateway 之前会强制改写成 `claude-code/{version} (external, cli)`。
  - 这会制造一个明显且没有必要的头部差异。
- 处理动作：
  - 改为不再强制覆盖客户端原始 `User-Agent`。
  - 让 gateway 透传官方客户端自己构造的值，避免制造额外差异。
- 回归验证：
  - 待本轮代码修改后重新本地请求，并在下一次 MITM 抓取中核对 gateway 上游头部。
- 剩余风险：
  - `entrypoint`、`client_type`、system prompt 中的 `cc_entrypoint` 仍未建立统一策略。
  - 不同调用模式下，真实官方客户端本身就可能发出不同 `User-Agent`。

### A-005 Canonical client persona

- 日期：2026-04-03
- 证据：
  - [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  - [main.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/main.tsx)
  - [system.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/system.ts)
- 当前差异：
  - 真实官方客户端会同时在多个面上暴露调用模式：
    - 请求头 `User-Agent`
    - 1P telemetry 中的 `entrypoint`
    - 1P telemetry 中的 `client_type`
    - system prompt attribution header 中的 `cc_entrypoint`
  - gateway 之前只处理了版本指纹，没有把这些字段作为同一组 persona 统一管理。
- 处理动作：
  - 新增 `client.user_agent`、`client.entrypoint`、`client.client_type` 配置。
  - `/api/event_logging/*` 中统一重写 `entrypoint` 和 `client_type`。
  - system prompt 文本中的 `cc_entrypoint` 也同步改写。
  - 请求头 `User-Agent` 支持使用统一 persona，未配置时透传客户端原值。
- 回归验证：
  - `npm run build` 已通过。
- 剩余风险：
  - 还未用新 persona 配置重新抓取 gateway 上游流量。
  - 交互模式和非交互模式天然存在差异，后续需要决定是“完全统一”还是“按账号/设备 persona 分组统一”。

### A-006 env 与 process 可选字段

- 日期：2026-04-03
- 证据：
  - [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  - [metadata.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/metadata.ts)
- 当前差异：
  - 参考源码里的 1P telemetry `env` 和 `process` 结构比 gateway 早期实现更丰富。
  - 之前只统一了主干字段，像 `remote_environment_type`、`wsl_version`、`linux_distro_*`、`external`、`arrayBuffers`、`cpuPercent` 这类字段仍可能泄漏真实环境。
- 处理动作：
  - 扩展 canonical `env` 可选字段透传和标准化能力。
  - 为 `process` 新增 `external_range`、`array_buffers_range`、`cpu_percent_range` 配置。
  - 更新 `config.example.yaml`，把这些字段纳入可配置范围。
- 回归验证：
  - `npm run build` 已通过。
- 剩余风险：
  - 还没重新抓一轮 gateway 上游的 `/api/event_logging/*`，暂未验证新字段是否已经完整落到出站体。
  - `cpuUsage` 仍保留真实值，这是当前有意保留的运行时动态量。

### A-007 attribution header 实测差异

- 日期：2026-04-03
- 证据：
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [capture.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/capture.py)
  - [system.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/system.ts)
- 当前差异：
  - 通过 gateway 实测出站消息体中：
    - `metadata.user_id.device_id` 已成功改写为 canonical device
    - `cc_entrypoint` 已成功改写为 `sdk-cli`
  - 但 billing header 仍暴露两处明显不一致：
    - `cc_version=2.1.81.000`，和当前真实 `User-Agent` 中的 `2.1.91` 不一致
    - `cch=00000` 被原样发送到上游
  - 参考源码说明 `cch=00000` 在官方 Bun HTTP 栈里会被 native attestation 覆写；Node 网关不会做这件事
- 处理动作：
  - 本轮先记录为已确认风险，下一步优先处理：
    - 版本对齐策略
    - `cch` 占位符剥离或替代策略
- 回归验证：
  - 本地抓包实例已成功返回 `200`
  - `mitm/gateway.log` 中已直接看到重写后的 `metadata.user_id` 和 billing header
- 剩余风险：
  - `cch=00000` 是当前最强的非官方实现信号之一
  - 只要 `env.version` 与真实 `User-Agent` 版本不一致，就会持续形成跨层矛盾

### A-008 canonical version 自动推导

- 日期：2026-04-03
- 证据：
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前差异：
  - 如果 `config.env.version` 手工维护滞后，而客户端真实 `User-Agent` 已升级，就会出现：
    - 请求头版本是新值
    - billing header / telemetry version 还是旧值
- 处理动作：
  - 引入 `getCanonicalVersion()`。
  - 优先从入站 `User-Agent` 自动解析版本。
  - 只有在无法解析时，才回退到 `config.env.version`。
  - `/_verify` 示例也切到同一套逻辑。
- 回归验证：
  - `npm run build` 已通过。
  - 最新 [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log) 已出现：
    - `User-Agent: claude-cli/2.1.91 (external, sdk-cli)`
    - `cc_version=2.1.91.000`
- 剩余风险：
  - `config.capture.yaml` 如果继续复用，会保留历史抓包行，读日志时要只看最后一次请求。

### A-009 cch 占位符剥离验证

- 日期：2026-04-03
- 证据：
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [system.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/system.ts)
- 当前差异：
  - 旧抓包里，gateway 出站 body 中仍然出现 `cch=00000`。
  - 这个值本应由官方 Bun native stack 在发包前替换，Node 网关无法生成。
- 处理动作：
  - 在 attribution header 文本重写阶段统一剥离 `cch=00000`。
  - 同步处理 header 重写分支。
- 回归验证：
  - 最新 [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log) 中，最新一条 `billing_header` 已不再包含 `cch=00000`。
- 剩余风险：
  - 虽然占位符已经去掉，但我们仍然无法伪造官方 native attestation，这个限制不会消失。

### A-010 Windows 抓包 flush 约束

- 日期：2026-04-03
- 证据：
  - [gateway.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.flows)
  - [extract_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/extract_signals.py)
  - [finalize-gateway-capture.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-gateway-capture.ps1)
- 当前差异：
  - Windows 下直接在 `mitmdump` 仍运行时读取 `.flows`，经常会得到空结果或旧结果。
- 处理动作：
  - 把“先停 mitmdump，再解析 `.flows`”固化成标准流程。
  - 新增 `scripts/finalize-gateway-capture.ps1` 负责 stop-and-read。
- 回归验证：
  - 停止 `mitmdump` 后，`gateway.flows` 成功读出最新单次请求信号。
- 剩余风险：
  - 后续如果改成常驻抓包模式，需要换成更适合增量读取的保存方式。

### A-011 /v1/messages 主链对齐结果

- 日期：2026-04-03
- 证据：
  - [gateway.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.flows)
  - [claude-cli.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.flows)
  - [diff_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/diff_signals.py)
- 当前差异：
  - 使用 `/v1/messages` 过滤后的 direct vs gateway diff，只剩两项：
    - `metadata.user_id` 中的 `device_id`
    - billing header 中 direct 有 `cch=00000`，gateway 已剥离
- 处理动作：
  - 版本号、beta 集合、`cc_entrypoint`、billing fingerprint 都已经对齐到最新 direct CLI 形态。
- 回归验证：
  - 最新单次 gateway 抓包结果为：
    - `user_agent = claude-cli/2.1.91 (external, sdk-cli)`
    - `billing_header = cc_version=2.1.91.9f2; cc_entrypoint=sdk-cli;`
    - `metadata.user_id.device_id = canonical device`
- 剩余风险：
  - `device_id` 的差异是我们有意保留的统一身份策略，不是 bug。
  - `cch` 无法被 Node 网关伪造，只能选择保留占位符或剥离；当前策略是剥离。

### A-012 custom base URL 行为面收缩

- 日期：2026-04-03
- 证据：
  - [providers.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/model/providers.ts)
  - [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)
  - [remoteManagedSettings/syncCache.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/syncCache.ts)
  - [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)
  - [commands.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/commands.ts)
- 当前差异：
  - gateway 场景下，实测最稳定出现的是 `/v1/messages`。
  - 一部分 first-party 控制面能力在源码里明确要求 `isFirstPartyAnthropicBaseUrl()` 为真。
- 处理动作：
  - 记录为架构层结论，而不是误判成“抓包漏了”。
  - 后续对 `/api/eval/*` 和 `/api/event_logging/*` 的验证，要区分：
    - 客户端本身是否还会发
    - gateway 是否把它们改写正确
- 回归验证：
  - 参考源码已确认 custom base URL 会让这些模块直接失去资格：
    - policy limits
    - remote managed settings
    - settings sync
    - 某些 console user 分支
- 剩余风险：
  - 这并不等于所有遥测都关闭。
  - `GrowthBook` 和 `1P event logging` 在 custom base URL 场景下的完整行为还需要专项复抓验证。

### A-013 quiet mode 与 alignment mode 分层

- 日期：2026-04-03
- 证据：
  - [privacyLevel.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/privacyLevel.ts)
  - [analytics/config.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/config.ts)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)
  - [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)
- 当前差异：
  - 之前我们在 gateway 测试里稳定只看到 `/v1/messages`。
  - 一开始容易把这个现象误判成：
    - gateway 没处理 `/api/eval/*`
    - gateway 没处理 `/api/event_logging/*`
    - 或者 MITM 没抓到
  - 实际上，测试配置里使用了 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`。
  - 这会把 privacy level 提升到 `essential-traffic`，直接关闭 telemetry：
    - GrowthBook
    - 1P event logging
    - 一批非必要控制面请求
- 处理动作：
  - 正式把客户端使用场景拆成两种模式：
    - `quiet mode`
    - `alignment mode`
  - 保留 [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example) 作为对外 quiet-mode 样例。
  - 新增 [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example) 作为研究模式样例。
  - 新增 [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md) 统一定义两种模式。
- 回归验证：
  - 参考源码已经确认：
    - `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 会让 `isTelemetryDisabled()` 为真
    - `GrowthBook` 依赖 `is1PEventLoggingEnabled()`
    - `1P event logging` 依赖 `isAnalyticsDisabled()` 为假
- 剩余风险：
  - `alignment mode` 下，即使放开 telemetry，一部分 side channel 仍可能直接打向 `api.anthropic.com`，不会自动经过 gateway。
  - 后续自动 diff 必须区分：
    - quiet mode 的“本就不该发”
    - alignment mode 的“应该发但没有抓到”

## 下一步优先级

1. 在 `alignment mode` 下重新抓取 direct CLI 与 gateway 上游流量
2. 逐项核对 `/v1/messages`、`/api/eval/*`、`/api/event_logging/*`
3. 把“直连 `api.anthropic.com` 的 side channel”单独建模，不再误算成 gateway 漏改写
4. 根据抓包差异继续补头部、body 和控制面请求
5. 评估 persona 分组策略，而不是把所有账号都压成同一个静态模板
