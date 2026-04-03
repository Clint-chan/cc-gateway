# 指纹与遥测目录

## 目的

这份文档是项目当前的“指纹面总表”。

它解决三个问题：

1. 我们到底在对齐哪些信号面
2. 每个信号面的证据来自哪里
3. 后续如果官方客户端更新，应该去哪里抓、改哪里、怎么验证

## 使用规则

每新增一个高风险信号面，或者每确认一个旧信号面的形态发生变化，都要同步更新这份文档。

和 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md) 的关系是：

- `fingerprint-catalog.md` 负责“全局目录”
- `packet-alignment-log.md` 负责“逐次修复记录”

## 证据源

### 抓包目录

- 目录：
  [mitm](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm)
- 关键文件：
  - [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  - [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
  - [claude-cli.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.flows)
  - [gateway.flows](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.flows)

### 抓包脚本目录

- [capture-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-gateway.ps1)
- [capture-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-direct.ps1)
- [finalize-gateway-capture.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-gateway-capture.ps1)
- [finalize-direct-capture.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-direct-capture.ps1)
- [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)
- [inspect-auth-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-auth-gating-state.ps1)
- [inspect-bridge-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-bridge-gating-state.ps1)
- [clear-grove-cache.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/clear-grove-cache.ps1)
- [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
- [sweep-event-logging-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-matrix.ps1)
- [sweep-event-logging-probe-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-probe-matrix.ps1)
- [prepare-trusted-capture-workspace.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/prepare-trusted-capture-workspace.ps1)
- [probe-growthbook-eval-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-growthbook-eval-direct.ps1)
- [extract_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/extract_signals.py)
- [diff_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/diff_signals.py)

### 参考源码目录

- 目录：
  [reference/claudecode_source](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source)
- 总览文章：
  [reference/README.md](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/README.md)

## 使用模式

### quiet mode

- 目标：
  给测试者和生产使用，尽量减少旁路流量
- 关键开关：
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`
- 结果：
  GrowthBook 和 1P event logging 都不会发

### alignment mode

- 目标：
  专门用于遥测研究和 MITM 对齐
- 关键要求：
  不要设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
- 结果：
  遥测面会重新暴露，但其中一部分仍可能直连 `api.anthropic.com`

### managed-oauth

- 目标：
  保留 first-party OAuth / subscriber 叙事
- 关键要求：
  - `CLAUDE_CODE_OAUTH_TOKEN=gateway-managed`
  - `ANTHROPIC_CUSTOM_HEADERS=x-api-key: <gateway-client-token>`
- 结果：
  更接近真实 Claude.ai subscriber 的 telemetry 面

### external-auth-token

- 目标：
  把 gateway token 直接塞进 `ANTHROPIC_AUTH_TOKEN`
- 结果：
  客户端会转到 external auth token 路径
- 当前结论：
  这条路径会改变：
  - `isClaudeAISubscriber()`
  - OAuth account 信息
  - GrowthBook attributes
  - 一部分 side channel 是否出现

如果没有先声明当前抓包属于哪种 `traffic mode` 和 `auth mode`，这份目录里的很多结论都会被误读。

## 信号面目录

### 1. 请求头层

#### 1.1 User-Agent

- 作用：
  服务端直接识别客户端形态、入口点和版本
- 真实来源：
  [client.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/client.ts)
- 抓包位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
- 当前实现：
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前策略：
  优先透传客户端原始 `User-Agent`，也支持通过 `client.user_agent` 做集中 persona 配置
- 维护入口：
  - `rewriteHeaders()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
  - `getCanonicalVersion()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 后续更新方式：
  每次升级 Claude Code 后，先抓 direct CLI，再核对 gateway 上游是否一致

#### 1.2 x-app / X-Claude-Code-Session-Id / x-client-request-id

- 作用：
  标识 first-party CLI 请求形态和单次请求链路
- 真实来源：
  [client.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/client.ts)
- 抓包位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
- 当前实现：
  [proxy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/proxy.ts)
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前策略：
  `x-app` 默认补 `cli`；其余优先透传客户端原值
- 风险说明：
  `session id` 和 `request id` 是会话动态量，不适合硬编码统一

#### 1.3 anthropic-beta

- 作用：
  决定功能开关、OAuth 模式和请求行为
- 真实来源：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前实现：
  [proxy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/proxy.ts)
- 当前策略：
  透传客户端原值，同时强制补 `oauth-2025-04-20`
- 后续更新方式：
  每次 direct CLI 抓包后核对是否新增高优先级 beta

### 2. 消息体 attribution 层

#### 2.1 metadata.user_id

- 作用：
  携带 `device_id`、`account_uuid`、`session_id`
- 真实来源：
  `/v1/messages` 请求体
- 抓包位置：
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
- 当前实现：
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前策略：
  统一 `device_id`，保留账号和会话维度

#### 2.2 x-anthropic-billing-header

- 作用：
  attribution header，包含 `cc_version`、`cc_entrypoint`、`cch`
- 真实来源：
  [system.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/system.ts)
  [fingerprint.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/fingerprint.ts)
- 抓包位置：
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log)
- 当前实现：
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前策略：
  - 重写 `cc_version`
  - 重写 `cc_entrypoint`
  - 剥离 `cch=00000`
- 维护入口：
  - `rewritePromptText()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
  - `getCanonicalVersion()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 最新验证：
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log) 的最新请求已验证：
  - `cc_version` 会跟随入站 `User-Agent` 版本
  - `cch=00000` 已被剥离
- 当前风险：
  我们无法在 Node 网关里生成官方 Bun native attestation
- 后续更新方式：
  每次升级后先验证 header 字段有没有新增

### 3. GrowthBook / eval 层

#### 3.1 /api/eval/sdk-*

- 作用：
  远程实验、特性开关、用户画像
- 真实来源：
  [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- 抓包位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前实现：
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 维护入口：
  - `rewriteEvalBody()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前已覆盖：
  - `attributes.id`
  - `attributes.deviceID`
  - `attributes.platform`
  - `attributes.email`
  - `attributes.appVersion`
  - `attributes.apiBaseUrlHost`
  - 顶层 `url`
- 当前未完全覆盖：
  - `sessionId`
  - `organizationUUID`
  - `accountUUID`
  - `subscriptionType`
  - `rateLimitTier`
- 当前调查状态：
  - headless `-p` 路径在 [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts) 中只会 `void initializeGrowthBook()`
  - local-jsx blocking gate 命令如果当前 cwd 没 trust，GrowthBook 也可能拿不到 auth headers
  - 详见 [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- 模式注意：
  `quiet mode` 下这一路本来就不会发，只有 `alignment mode` 才适合验证
- auth 注意：
  `managed-oauth` 与 `external-auth-token` 会直接改变这一路是否出现
- 快速检查：
  - [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)
- 后续更新方式：
  需要专门复抓一轮带 eval 的请求，核对 gateway 实际出站体

#### 3.2 Grove 控制面

- 作用：
  consumer subscriber 的隐私设置和 notice config 控制面
- 真实来源：
  [grove.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/grove.ts)
  [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)
  [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
- 相关 endpoint：
  - `/api/oauth/account/settings`
  - `/api/claude_code_grove`
- 当前策略：
  不把它继续当作 via-gateway 的普通“未观测面”，而是先按 auth model 判断是否应当存在
- 当前结论：
  - trusted direct + local Claude.ai subscriber 会话可以看到这两条面
  - trusted via-gateway 的 `managed-oauth` / `external-auth-token` 当前都属于 `auth-model-suppressed`
- 快速检查：
  - [inspect-auth-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-auth-gating-state.ps1)
  - [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)
- 冷缓存辅助：
  - [clear-grove-cache.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/clear-grove-cache.ps1)
- 详细说明：
  - [grove-control-plane-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/grove-control-plane-gating.md)
- 后续更新方式：
  以后 Grove 再次出现或消失时，先跑 auth gating 检查，再决定是否做冷缓存复抓

#### 3.3 Remote Control / bridge gating

- 作用：
  区分 `claude remote-control` 是卡在 subscriber、profile scope、organization 还是 feature gate
- 真实来源：
  [cli.tsx](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/entrypoints/cli.tsx)
  [bridgeEnabled.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/bridge/bridgeEnabled.ts)
- 当前策略：
  不再把 `remote-control` 当作通用 `/api/eval/*` probe，而是单独作为 bridge entitlement probe
- 快速检查：
  - [inspect-bridge-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-bridge-gating-state.ps1)
  - [inspect-auth-gating-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-auth-gating-state.ps1)
- 详细说明：
  - [remote-control-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/remote-control-gating.md)
- 当前结论：
  - local direct subscriber 会话当前会卡在 bridge feature gate
  - `managed-oauth` 会卡在 full-scope login 要求
  - `external-auth-token` 会卡在 claude.ai subscription 要求

### 4. 1P event logging 层

#### 4.1 /api/event_logging/v2/batch

- 作用：
  first-party BigQuery 遥测主通道
- 真实来源：
  [metadata.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/metadata.ts)
  [firstPartyEventLoggingExporter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLoggingExporter.ts)
- 抓包位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前实现：
  [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 维护入口：
  - `rewriteEventBatch()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
  - `buildCanonicalEnv()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
  - `buildCanonicalProcess()`
    [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- 当前已覆盖：
  - `device_id`
  - `email`
  - `entrypoint`
  - `client_type`
  - 主干 `env`
  - 主干 `process`
  - `additional_metadata` 中的 `baseUrl` / `gateway`
- 当前扩展覆盖：
  - `remote_environment_type`
  - `coworker_type`
  - `claude_code_container_id`
  - `claude_code_remote_session_id`
  - `tags`
  - `wsl_version`
  - `linux_distro_*`
  - `linux_kernel`
  - `vcs`
  - `external`
  - `arrayBuffers`
  - `cpuPercent`
- 当前阈值结论：
  - `RepeatCount=1`
    在 `DelayMilliseconds=0 / 250 / 1000` 上都不会触发
  - `RepeatCount=2`
    已确认属于 `delay-sensitive` 命中区间
  - `RepeatCount=3`
    是当前跨三组 delay 的稳定下界
- 当前 probe-type 结论：
  - `hello`
    在 `DelayMilliseconds=250` 下，`RepeatCount=2` 仍 miss
  - `hello-json-verbose`
    在 `DelayMilliseconds=250` 下，`RepeatCount=2` 已命中
  - `hello-stream-json-verbose`
    在 `DelayMilliseconds=250` 下，`RepeatCount=1` 就能命中
- 推荐研究入口：
  - [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
  - [event-logging-probe-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-probe-workflow.md)
- 当前未完全验证：
  当前 headless 最小请求已经确认这一路会发，但在 gateway 场景下它仍然走 direct-host side channel，而不是经过 gateway
- 最新实抓：
  [gateway.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/gateway.log) 已确认：
  - `/api/event_logging/v2/batch` 仍带真实 `win32` 环境和真实 `device_id`
  - 同一次抓包里的 `/v1/messages` 已经是 canonical device
- via-gateway 补充：
  在 trusted `via-gateway` 的 `managed-oauth` 路径下，最新 threshold sweep 已确认：
  - `RepeatCount=1` 在当前测试的 `0 / 250 / 1000ms` 上都不触发
  - `RepeatCount=2` 不是简单“不稳定”，而是明确 `delay-sensitive`
  - `RepeatCount=3` 是当前跨三组 delay 的稳定下界
  - 进一步的 probe matrix 也已确认：
    - `hello-stream-json-verbose` 会把阈值继续压低到 `RepeatCount=1`
- 模式注意：
  `quiet mode` 下 1P event logging 会被 privacy level 直接关闭

### 5. 控制面与功能开关

#### 5.0 认证模型本身

- 作用：
  决定 CLI 到底按 first-party OAuth subscriber 叙事发请求，还是按 external auth token 叙事发请求
- 参考位置：
  - [auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)
  - [http.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/http.ts)
  - [user.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/user.ts)
- 当前状态：
  已确认 `ANTHROPIC_AUTH_TOKEN` 与 `CLAUDE_CODE_OAUTH_TOKEN` 会导致不同 side-channel 面
- 当前策略：
  - 研究默认：`managed-oauth`
  - 生产默认：`quiet + managed-oauth`
  - `external-auth-token` 仅作专项实验

#### 5.1 /api/claude_cli/bootstrap

- 作用：
  启动期 bootstrap 和配置拉取
- 参考位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前状态：
  trusted capture workspace 下的 `headless-hello` 已再次复现

#### 5.2 /api/oauth/account/settings

- 作用：
  账户设置与订阅信息
- 参考位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前状态：
  trusted capture workspace 下的 `headless-hello` 已再次复现；gateway 场景待单独复抓

#### 5.3 /v1/mcp_servers 与 registry 相关接口

- 作用：
  MCP 能力发现
- 参考位置：
  [claude-cli.log](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/claude-cli.log)
- 当前状态：
  trusted capture workspace 下的 `headless-hello` 已复现：
  - `/v1/mcp_servers`
  - `/mcp-registry/v0/servers`

#### 5.4 custom base URL gating

- 作用：
  决定哪些控制面和同步类功能仍然会发请求
- 参考位置：
  - [providers.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/model/providers.ts)
  - [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)
  - [remoteManagedSettings/syncCache.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/syncCache.ts)
  - [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)
  - [commands.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/commands.ts)
- 当前结论：
  custom `ANTHROPIC_BASE_URL` 不只是换目标地址，还会让一批 only-first-party 控制面逻辑直接不再生效
- 风险说明：
  后续看到“某些路由没发出来”时，不能默认当作抓包失败或 gateway 改坏了

#### 5.5 quiet mode gating

- 作用：
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` 会主动压掉 telemetry 和多条非必要控制面请求
- 参考位置：
  - [privacyLevel.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/privacyLevel.ts)
  - [analytics/config.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/config.ts)
  - [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
  - [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)
- 当前结论：
  这不是“请求没抓到”，而是客户端被显式配置成不发
- 风险说明：
  自动 diff 必须把 quiet mode 和 alignment mode 分开跑

## 快速跟进最新指纹的方法

### 方法一：直接抓官方客户端

1. 用本机 direct CLI 跑一次最小请求
2. 抓 `claude-cli.flows` 和 `claude-cli.log`
3. 如果要看 `/api/eval/*`，先走 [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
4. 如果要看 telemetry，确保当前是 `alignment mode`
5. 看是否新增：
   - 新 header
   - 新 beta
   - 新 telemetry 路径
   - 新 body 字段

### 方法二：抓 gateway 上游

1. 起抓包专用 gateway
2. 让 gateway 的 `network.proxy_url` 指向 mitm
3. 让 mitm 上游再走 `10808`
4. 如果要验证 eval / 1P event logging，客户端不能开 quiet mode
5. 对比：
   - `claude-cli.log`
   - `gateway.log`
6. 读 `gateway.log` 时只看最后一次请求，不要把历史抓包行误判成当前结果
7. 如果要解析 `.flows`，先停止 `mitmdump`，再运行提取或 diff 脚本
8. 如果要抽单个 endpoint，优先用：
   - `python mitm/extract_signals.py mitm/direct.flows 10 /api/eval/`
   - `python mitm/extract_signals.py mitm/direct.flows 10 /v1/messages`
   - `python mitm/diff_signals.py mitm/direct.flows mitm/gateway.flows /v1/messages`

### 方法三：对照参考源码

优先看这些文件：

- [client.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/api/client.ts)
- [system.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/constants/system.ts)
- [fingerprint.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/fingerprint.ts)
- [metadata.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/metadata.ts)

## 当前结论

现在我们的指纹配置不应该被视为“离散配置项集合”，而应该被视为“集中管理的一组 persona 与 telemetry 策略”。

后面无论做前端管理界面、账号池还是代理池，都应该围绕这份目录来设计：

- 一个 persona 对应哪些 header
- 一个 persona 对应哪些 telemetry 字段
- 一个 persona 对应哪些抓包证据
- 一次升级后哪些地方需要重新验证

同时还要把每个 endpoint 的 transport ownership 单独管理。

参考：

- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
