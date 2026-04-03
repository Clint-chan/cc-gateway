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

### A-000 Grove 控制面 auth gating 冻结

- 日期：2026-04-03
- 证据：
  - [grove.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/grove.ts)
  - [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
  - [grove-control-plane-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/grove-control-plane-gating.md)
- 当前差异：
  - trusted direct 的 local subscriber 会话曾经抓到：
    - `/api/claude_code_grove`
    - `/api/oauth/account/settings`
  - 但 trusted via-gateway 的 `managed-oauth` / `external-auth-token` 一直看不到这两条面。
  - 之前这两行还只能先记成 “not-observed”。
- 处理动作：
  - 重新对照参考源码，冻结了 Grove 的 auth gating：
    - `CLAUDE_CODE_OAUTH_TOKEN` 会被客户端视为 inference-only token，`subscriptionType = null`
    - `isConsumerSubscriber()` 要求 `subscriptionType in { max, pro }`
    - `ANTHROPIC_AUTH_TOKEN` 直接切到 external auth token 路径
  - 因此当前 via-gateway 两种 auth mode 下，Grove 控制面统一改记为：
    - `auth-model-suppressed`
  - 同时补了两个研究辅助脚本：
    - [inspect-auth-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-auth-gating-state.ps1)
    - [clear-grove-cache.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/clear-grove-cache.ps1)
- 回归验证：
  - 清掉本机 `groveConfigCache` 后再次跑 trusted via-gateway `managed-oauth`，Grove 控制面仍未重新出现，而且本地也没有重新写回 `groveConfigCache`
  - 这证明当前 via-gateway 缺失 Grove 的根因不是缓存短路，而是 auth model 本身
- 剩余风险：
  - 如果未来 Claude Code 改写了 env token 的 subscription 语义，这个结论需要重新复核
  - 目前这条结论只冻结到当前版本和当前接入模型，不代表 future subscriber-managed gateway 一定无法恢复 Grove 面

### A-000a Remote Control gating 冻结

- 日期：2026-04-03
- 证据：
  - [cli.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/entrypoints/cli.tsx)
  - [bridgeEnabled.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/bridge/bridgeEnabled.ts)
  - [remote-control-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/remote-control-gating.md)
- 当前差异：
  - 之前 `remote-control` 抓不到 `/api/eval/*` 时，还存在“是不是代理没带上”的不确定性
  - 这会把 bridge entitlement 问题和 telemetry probe 问题混在一起
- 处理动作：
  - 冻结了 `remote-control` 的真实 gating 顺序：
    - OAuth access token
    - `isClaudeAISubscriber()`
    - `hasProfileScope()`
    - `organizationUuid`
    - `tengu_ccr_bridge`
  - 新增：
    - [inspect-bridge-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-bridge-gating-state.ps1)
  - 把 `remote-control` 从通用 eval probe 降级成 bridge entitlement probe
- 回归验证：
  - local direct subscriber：`Remote Control is not yet enabled for your account.`
  - via-gateway `managed-oauth`：`requires a full-scope login token`
  - via-gateway `external-auth-token`：`requires a claude.ai subscription`
- 剩余风险：
  - 当前脚本里的 bridge gate 仍以本地缓存为近似判断；最终结论仍以真实命令输出为准
  - 如果 upstream 调整 bridge gating 顺序，这份结论需要重跑

### A-000b Event Logging 阈值矩阵冻结

- 日期：2026-04-03
- 证据：
  - [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
  - [event_logging_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/event_logging_matrix_2026-04-03.json)
  - [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)
  - [firstPartyEventLoggingExporter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLoggingExporter.ts)
- 当前差异：
  - 之前我们只能冻结一维结论：
    - `RepeatCount=3` 在 `DelayMilliseconds=250` 下能复现
  - 但这还无法解释：
    - `RepeatCount=2` 为什么有时命中、有时 miss
    - 到底是次数问题，还是 delay 问题
- 处理动作：
  - 新增：
    - [sweep-event-logging-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-matrix.ps1)
  - 为阈值脚本补了结构化输出：
    - [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
  - 实跑了 `RepeatCount={1,2,3}`、`DelayMilliseconds={0,250,1000}` 的二维矩阵
- 回归验证：
  - `RepeatCount=1`
    在 `0 / 250 / 1000ms` 上都未触发 `event_logging`
  - `RepeatCount=2`
    在 `0ms`、`1000ms` 命中，在 `250ms` miss
  - `RepeatCount=3`
    在 `0 / 250 / 1000ms` 上都稳定触发，而且仍然只出现在 direct side-channel
- 剩余风险：
  - 当前结论只冻结了 `hello` probe，不代表所有 probe 类型都等价
  - `EventDirectCount` 的绝对数量还会受 exporter batching/shutdown flush 影响，所以后续更适合把“是否出现”和“owner”当成主判断，而不是只看批次数

### A-000c Event Logging probe-type 矩阵冻结

- 日期：2026-04-03
- 证据：
  - [event-logging-probe-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-probe-workflow.md)
  - [event_logging_probe_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/event_logging_probe_matrix_2026-04-03.json)
  - [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)
  - [gracefulShutdown.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/gracefulShutdown.ts)
- 当前差异：
  - 之前我们已经知道 `event_logging` 对 `repeat / delay` 敏感
  - 但还不知道同一条 `--print` 主链下，不同输出路径会不会继续改变阈值
- 处理动作：
  - 扩展：
    - [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)
    - [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
  - 新增：
    - [sweep-event-logging-probe-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-probe-matrix.ps1)
  - 固定 `managed-oauth + DelayMilliseconds=250 + RepeatCount={1,2}`，对比：
    - `hello`
    - `hello-json-verbose`
    - `hello-stream-json-verbose`
- 回归验证：
  - `hello`
    在 `RepeatCount=1,2` 下都没有触发 `event_logging`
  - `hello-json-verbose`
    在 `RepeatCount=2` 时已触发 `event_logging`
  - `hello-stream-json-verbose`
    在 `RepeatCount=1` 时就已触发 `event_logging`
- 剩余风险：
  - 当前 probe matrix 只冻结了 `--print` 路径，不代表 interactive 或 resume/continue 路径一定等价
  - 这条结论更适合指导“如何复抓和快速定位”，不应直接外推成生产配置建议

### A-000d Eval 字段矩阵冻结

- 日期：2026-04-03
- 证据：
  - [eval-field-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/eval-field-matrix.md)
  - [eval_field_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_field_matrix_2026-04-03.json)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
  - [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
- 当前差异：
  - 之前我们只知道 `/api/eval/*` 存在、受 auth mode 影响，也知道 gateway 已有一部分 `rewriteEvalBody()` 覆盖。
  - 但还没有冻结“到底哪些字段在两个基线里稳定、哪些字段是 auth-model-sensitive、哪些字段只是 session/runtime 噪音”。
- 处理动作：
  - 新增字段目标清单：
    - [eval_attribute_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/eval_attribute_targets.json)
  - 新增结构化提取脚本：
    - [summarize_eval_field_matrix.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/summarize_eval_field_matrix.py)
  - 用两条已冻结基线生成了结构化矩阵：
    - `direct-subscriber`
    - `managed-oauth-via-gateway-side-channel`
- 回归验证：
  - 当前矩阵已经冻结出 4 类结论：
    - `subscriptionType`、`rateLimitTier`、`firstTokenTime` 在 direct subscriber 存在，在 managed-oauth side-channel 消失
    - `apiBaseUrlHost` 只在 custom base URL 侧出现
    - `sessionId` 在 side-channel capture 中按请求变化
    - `id`、`deviceID`、`organizationUUID`、`accountUUID`、`email`、`appVersion` 等字段在当前两条基线上保持稳定
- 剩余风险：
  - 当前矩阵只冻结到 `managed-oauth` 的 via-gateway side-channel，不代表 `external-auth-token` 下一定等价
  - 如果 upstream 扩展 eval schema，必须先更新字段目标清单，再重新生成矩阵

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

### A-014 transport ownership 分层

- 日期：2026-04-03
- 证据：
  - [oauth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/oauth.ts)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [firstPartyEventLoggingExporter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLoggingExporter.ts)
  - [metricsOptOut.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/metricsOptOut.ts)
  - [officialRegistry.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/mcp/officialRegistry.ts)
  - [filesApi.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/filesApi.ts)
- 当前差异：
  - 之前我们容易把“没经过 gateway”的请求和“gateway 没改写”的请求混在一起。
  - 参考源码已经说明，请求至少分三类：
    - 归 gateway 主链的
    - 默认直连 first-party host 的
    - 被 quiet/custom-base-url 直接裁掉的
- 处理动作：
  - 新增 [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
  - 把已确认路径按 transport ownership 分类，后续自动 diff 先按归属分桶
- 回归验证：
  - 源码已确认：
    - Files API 会优先吃 `ANTHROPIC_BASE_URL`
    - GrowthBook 默认直指 `https://api.anthropic.com/`
    - 1P event logging 默认直指 `https://api.anthropic.com`
    - metrics opt-out 和 official MCP registry 也有 direct-host 路径
- 剩余风险：
  - `BASE_API_URL` 系列控制面路径还要继续细分哪些是“允许自定义 OAuth base”与哪些是“始终 prod/staging”
  - 后续抓包要验证这些源码结论在当前版本里是否都还成立

### A-015 alignment mode 头less 实抓结果

- 日期：2026-04-03
- 证据：
  - [direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.log)
  - [direct.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.flows)
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [gateway.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.flows)
- 当前差异：
  - 在 `alignment mode` 下重新跑最小 headless 请求：
    - direct CLI 发出了：
      - `POST /api/event_logging/v2/batch`
      - `POST /v1/messages?beta=true`
    - gateway 场景也发出了：
      - `POST /api/event_logging/v2/batch`
      - `POST /v1/messages?beta=true`
  - 但 `gateway` 抓包中的 `event_logging` 事件仍然带着真实本机侧信号：
    - `device_id = 388c...`
    - `platform = win32`
    - `version = 2.1.91`
  - 同一次 gateway 抓包里的 `/v1/messages` 已经是 canonical device：
    - `device_id = 9253...`
- 处理动作：
  - 正式确认：
    - `headless + alignment mode` 会发 `1P event logging`
    - 这一路在当前架构下不经过 gateway 改写
  - transport ownership 目录和指纹目录同步更新
- 回归验证：
  - direct 最小请求成功返回 `Hello! How can I help you today?`
  - gateway 最小请求也成功返回 `Hello! How can I help you today?`
  - `/v1/messages` diff 仍然只剩：
    - canonical `device_id`
    - `cch` 剥离
- 剩余风险：
  - 这意味着如果用户不开 `quiet mode`，真实本机 `event_logging` 仍会直连 first-party 并暴露环境指纹。
  - 生产使用必须继续坚持 `quiet mode`，研究时才切到 `alignment mode`。

### A-016 `/api/eval/*` 在当前 headless 最小路径里仍未出现

- 日期：2026-04-03
- 证据：
  - [direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.log)
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- 当前差异：
  - 在 direct 和 gateway 的当前最小 headless 请求里，都没有捕获到 `/api/eval/*`。
  - 但旧抓包里这一路存在，源码里 headless 也会 `void initializeGrowthBook()`。
- 处理动作：
  - 先记录为“当前触发条件未满足”，不误判成 gateway 改写缺失。
  - 下一轮改为专项追：
    - `headless` 退出时序
    - `initializeGrowthBook()` 的异步完成条件
    - 是否需要 interactive 场景或更长生命周期才能稳定触发
- 回归验证：
  - 当前 direct / gateway 最小请求日志都只出现：
    - `event_logging`
    - `v1/messages`
- 剩余风险：
  - `/api/eval/*` 仍是当前未完全验掉的面
  - 不能因为 `/api/eval/*` 没抓到，就默认这一路已经安全

### A-017 `/api/eval/*` 缺失的前置条件已拆清

- 日期：2026-04-03
- 证据：
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)
  - [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json)
  - [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- 当前差异：
  - 之前只知道“当前 headless 最小抓包里没看到 `/api/eval/*`”，但不知道究竟是：
    - 进程先退了
    - trust 没建立
    - 还是路径真的不发了
  - 现在已经拆清两层前置条件：
    - headless `-p` 里 GrowthBook 只做 `void initializeGrowthBook()`，不保证在进程退出前完成 remote eval
    - local-jsx / interactive 命令如果当前 cwd 没 trust，就可能直接拿不到 GrowthBook auth headers
- 处理动作：
  - 新增 [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)，把 `/api/eval/*` 的触发条件、缓存影响和验证顺序单独固化
  - 新增 [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)，用于快速检查：
    - cwd trust
    - `cachedGrowthBookFeatures`
    - 关键 gate 当前缓存值
  - 记录当前本机状态：
    - `~/.claude.json` 已有大量 GrowthBook 磁盘缓存
    - 当前记录到的 home project trust 为 `false`
- 回归验证：
  - `claude remote-control` 当前会返回 `Remote Control is not yet enabled for your account.`
  - 同时 direct MITM 抓包中没有出现任何 `/api/eval/*`，与“当前 cwd 无 trust、GrowthBook auth 可能被短路”的源码逻辑一致
- 剩余风险：
  - 这仍然不是 `/api/eval/*` 已消失的证据
  - 下一轮如果要继续实抓，必须优先选择：
    - trusted 的长生命周期会话
    - 或者一个 non-interactive 且明确阻塞 GrowthBook 的入口

### A-018 trusted workspace 下的 headless 最小请求已重新抓到 `/api/eval/*`

- 日期：2026-04-03
- 证据：
  - [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
  - [direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.log)
  - [direct.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.flows)
  - [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json)
- 当前差异：
  - 之前我们只能说“默认 cwd 的最小 headless 抓包里没看到 `/api/eval/*`”。
  - 现在在独立 trusted workspace 下，同样是 `claude -p "hello"`，已经明确抓到：
    - `POST /api/eval/sdk-*`
    - `GET /v1/mcp_servers`
    - `GET /api/claude_cli/bootstrap`
    - `GET /api/claude_code_grove`
    - `GET /api/oauth/account/settings`
    - `GET /mcp-registry/v0/servers`
    - `POST /v1/messages?beta=true`
- 处理动作：
  - 正式撤销“headless 基本抓不到 `/api/eval/*`”这类过强判断
  - 把 trusted workspace + headless 最小请求升级为 `/api/eval/*` 的标准 direct probe
  - 新增 [prepare-trusted-capture-workspace.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/prepare-trusted-capture-workspace.ps1)
  - 新增 [probe-growthbook-eval-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-growthbook-eval-direct.ps1)
- 回归验证：
  - [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1) 已确认：
    - home trust = `false`
    - trusted capture workspace trust = `true`
  - `headless-hello` 在该工作区里成功返回 `Hello! How can I help you today?`
  - `direct.log` 中已出现 `SIGNAL eval.attributes=...`
- 剩余风险：
  - 当前结论仍是 direct 场景；下一轮还要做 trusted via-gateway 对照
  - `/api/event_logging/*` 在这次 trusted headless 对照里没有同步出现，后面要继续看它的 gating 和时序

### A-019 `remote-control` 空抓包不再能解释成“系统代理没生效”

- 日期：2026-04-03
- 证据：
  - [direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/direct.log)
  - [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
  - [cli.js](/C:/Users/94503/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/cli.js)
- 当前差异：
  - 之前 `claude remote-control` 在 MITM 下可能没有留下任何流量，容易让人误判成“代理没接上”。
  - 现在同一 trusted workspace、同一 MITM 端口下，`headless-hello` 已经抓到 `/api/eval/*` 和多条 first-party 控制面请求。
- 处理动作：
  - 把 `remote-control` 从“默认 `/api/eval/*` 探针”降级为“bridge/entitlement 专项探针”
  - 在调查文档里明确：`remote-control` 空抓包更可能是命令逻辑、bridge gating 或 entitlement 早于网络发包返回
- 回归验证：
  - trusted workspace 的 `headless-hello` 已经证明 env proxy + MITM 链路整体是好的
- 剩余风险：
  - `remote-control` 具体在哪一步提前返回，还要继续对照 bundle 源码和 debug 日志拆
  - 这条链还不能直接拿来推断 gateway 对 `/api/eval/*` 的覆盖率

### A-020 trusted `via-gateway` 双通道已拆出主链和直连控制面

- 日期：2026-04-03
- 证据：
  - [capture-dual-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-dual-via-gateway.ps1)
  - [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)
  - [finalize-dual-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-dual-via-gateway.ps1)
  - [dual-direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.log)
  - [dual-gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-gateway.log)
- 当前差异：
  - 当客户端既要走 gateway，又要把直连 side channel 送进 direct MITM 时，单纯设置 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY` 还不够。
  - 如果不补 `NO_PROXY=localhost,127.0.0.1`，客户端会把 `https://localhost:9443` 这条主链也一起送去 direct MITM，导致请求卡住。
  - 补上 `NO_PROXY` 之后，双通道最小请求已经稳定拆开：
    - gateway 上游只看到 `POST /v1/messages?beta=true`
    - direct side-channel 看到：
      - `GET /v1/mcp_servers`
      - `GET /api/claude_cli/bootstrap`
      - `GET /api/claude_code_penguin_mode`
      - `GET /mcp-registry/v0/servers`
- 处理动作：
  - 新增 trusted via-gateway probe 脚本：
    [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)
  - 新增双通道 capture / finalize 脚本
  - 在 workflow 文档里固化 `NO_PROXY` 要求
- 回归验证：
  - 补 `NO_PROXY` 后，`claude -p "hello"` 已重新成功返回
  - gateway 上游 `.flows` 已稳定提取出 `/v1/messages`
  - direct side-channel `.log` 已稳定提取出多个 first-party 控制面请求
- 剩余风险：
  - 本轮双通道中没有看到 `/api/eval/*` 和 `/api/event_logging/*`
  - 这更可能说明 custom base URL 场景下的 gating / 时序问题，而不是它们永远不存在
  - 下一轮需要继续用这套双通道工作流追这两条路径

### A-021 客户端接入模型会直接改写遥测面

- 日期：2026-04-03
- 证据：
  - [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
  - [http.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/http.ts)
  - [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)
  - [dual-direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.log)
- 当前差异：
  - 之前默认把 gateway client token 塞进 `ANTHROPIC_AUTH_TOKEN`
  - 参考源码已确认，这会被官方客户端视为 external auth token
  - 结果不是“换一种 header 写法”，而是会直接改变：
    - `isAnthropicAuthEnabled()`
    - `isClaudeAISubscriber()`
    - OAuth account 信息可见性
    - GrowthBook attributes
    - 一部分 side channel 是否出现
  - trusted `via-gateway` 双通道实抓已经确认：
    - `managed-oauth` 下，direct side-channel 重新出现了 `POST /api/eval/sdk-*`
    - `external-auth-token` 下，同一工作流里 `/api/eval/*` 没有出现
- 处理动作：
  - 新增 `AuthMode` 到 trusted `via-gateway` 脚本
  - 把双通道 workflow 默认切到 `managed-oauth`
  - 更新 [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example) 和 [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)
  - 文档层正式把：
    - `traffic mode`
    - `auth mode`
    拆成两个正交维度
- 回归验证：
  - `managed-oauth` 的 trusted `via-gateway` probe 已成功返回 `Hello! How can I help you today?`
  - `finalize-dual-via-gateway.ps1` 已提取出：
    - direct: `POST /api/eval/sdk-*`
    - gateway upstream: `POST /v1/messages?beta=true`
- 剩余风险：
  - `event_logging` 在 `managed-oauth` 下的 trusted `via-gateway` 时序还没完全跑出来
  - bootstrap / penguin / MCP 等 side channel 还要继续做 auth-mode-sensitive 矩阵整理

### A-022 `event_logging` 在 `managed-oauth` 下仍然是 direct side-channel

- 日期：2026-04-03
- 证据：
  - [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)
  - [finalize-dual-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-dual-via-gateway.ps1)
  - [dual-direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.log)
  - [dual-direct.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.flows)
- 当前差异：
  - 之前在 `managed-oauth` 下的单次最小 via-gateway probe 里，我们看到了 `/api/eval/sdk-*`，但没有看到 `/api/event_logging/*`
  - 这容易被误判成：
    - `managed-oauth` 不发 event logging
    - 或者 event logging 只在 external-auth-token 下出现
  - 实际复抓后已经确认：
    - 在 `managed-oauth` 下，把 trusted via-gateway probe 跑两次
    - direct side-channel 会重新出现 `POST /api/event_logging/v2/batch`
    - gateway upstream 仍然只看到 `/v1/messages`
- 处理动作：
  - 给 [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1) 增加：
    - `RepeatCount`
    - `DelayMilliseconds`
  - 给 [finalize-dual-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-dual-via-gateway.ps1) 增加 `/api/event_logging/` 摘要输出
  - 给 [capture-dual-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-dual-via-gateway.ps1) 增加重复 probe 的推荐命令
- 回归验证：
  - `managed-oauth + RepeatCount=2` 下，direct side-channel 已提取到：
    - `event.entrypoint = sdk-cli`
    - `event.client_type = sdk-cli`
    - `event.device_id = 388c...`
    - `event.email = bodedreyer@gmail.com`
    - `event.env.platform = win32`
  - 同一轮 gateway upstream 仍未出现 `/api/event_logging/*`
- 剩余风险：
  - 当前只确认了“重复 probe 后会出现”
  - 还没冻结最小稳定触发条件，比如：
    - 单次请求是否偶发就够
    - 重复次数阈值
    - 是否和 query 间隔有关

### A-023 auth-mode-sensitive 控制面矩阵已冻结成独立资产

- 日期：2026-04-03
- 证据：
  - [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
  - [control_plane_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/control_plane_targets.json)
  - [summarize_control_plane_matrix.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/summarize_control_plane_matrix.py)
  - [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
- 当前差异：
  - 之前关于 `managed-oauth`、`external-auth-token`、`/api/eval/*`、`bootstrap`、`penguin`、`MCP`、`event_logging` 的结论，分散在：
    - 抓包日志
    - capture 脚本说明
    - alignment log 历史条目
  - 这会让后续版本升级时，仍然需要人工翻多份文档才能回答：
    - 这是不是 auth mode 导致的
    - 这条链当前应该出现在哪里
    - 这轮变化到底算 transport 变化还是 rewrite 缺口
- 处理动作：
  - 新增独立矩阵文档 [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
  - 新增结构化目标清单 [control_plane_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/control_plane_targets.json)
  - 新增矩阵摘要脚本 [summarize_control_plane_matrix.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/summarize_control_plane_matrix.py)
  - 把 trusted `via-gateway` 的复跑入口、输出命令和更新顺序统一挂到矩阵资产上
- 回归验证：
  - `python -m py_compile mitm\\summarize_control_plane_matrix.py`
  - `python mitm\\summarize_control_plane_matrix.py --mode-label current-capture`
- 剩余风险：
  - 当前矩阵冻结的是“已观测到的最小基线”，不是所有路径的最终结论
  - `/api/oauth/account/settings` 和 `/api/claude_code_grove` 在 via-gateway 最小 probe 里仍未重新出现
  - `event_logging` 的最小稳定触发阈值还要继续补

### A-024 `event_logging` 阈值扫面已经得到当前可复现下界

- 日期：2026-04-03
- 证据：
  - [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
  - [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
  - [dual-direct.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-direct.log)
  - [dual-gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/dual-gateway.log)
- 当前差异：
  - 我们之前只能说：
    - `RepeatCount=2` 曾经抓到过一次
    - 但还不能证明这是稳定阈值
  - 新的专项 sweep 已确认，在当前固定条件下：
    - `RepeatCount=1` 时 `event_logging` 没出现
    - `RepeatCount=2` 时 `event_logging` 仍没出现
    - `RepeatCount=3`、`5` 时 `event_logging` 已重新出现
  - 这意味着：
    - `2` 不是当前可冻结的稳定阈值
    - 当前已验证的可复现下界是 `3`
- 处理动作：
  - 新增 [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
  - 修复 PowerShell 参数解析，确保 `-RepeatCounts 1,2` 不再被错误吃成 `12`
  - 新增 [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
  - 把阈值结论回写到：
    - [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
    - [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
    - [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
- 回归验证：
  - `powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1 -RepeatCounts 1,2`
  - `powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1 -RepeatCounts 3,5`
- 剩余风险：
  - 这里冻结的是当前机器/账号/延迟 `250ms` 下的经验下界，不是跨环境定律
  - 还要继续验证：
    - 更小 delay 下是否仍然 `3` 次即可
    - 是否存在不同 session 生命周期导致的波动

## 下一步优先级

1. 专项触发 `/api/eval/*`，验证它到底是 headless 退出问题还是场景问题
2. 用 transport ownership 地图继续细分 `BASE_API_URL` 控制面
3. 评估有没有办法把 direct-host side channel 也纳入统一出口或显式压制
4. 根据抓包差异继续补头部、body 和控制面请求
5. 评估 persona 分组策略，而不是把所有账号都压成同一个静态模板
