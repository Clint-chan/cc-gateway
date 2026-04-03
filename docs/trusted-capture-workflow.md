# Trusted Capture Workflow

## 目的

这份文档定义一条独立于主仓库目录和 home 目录的 trusted capture 路线。

它的目标不是“方便日常使用”，而是解决一个很具体的问题：

> 当我们要追 `/api/eval/*` 这类依赖 GrowthBook auth 和 trust 状态的路径时，不能继续混用 home 目录、主仓库目录和历史磁盘缓存。

## 为什么要单独建工作区

当前已经确认：

1. Claude Code 的 project trust 是按 project key 记在 [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json) 里的
2. 如果一直从 home 目录启动，project key 会变成 `C:/Users/94503`
3. local-jsx / interactive 命令在当前 cwd 没 trust 时，GrowthBook 可能拿不到 auth headers
4. 这会直接污染 `/api/eval/*` 的抓包结论

所以正确做法不是：

- 把整个 home 目录直接当作 trusted capture 环境
- 也不是把主仓库根目录直接混进日常使用和研究使用

正确做法是：

- 创建一个**独立、非 git 的最小抓包工作区**
- 单独给它 project trust
- 专门用它追 `/api/eval/*`、GrowthBook、blocking gate 这类路径

## 推荐目录

默认推荐：

- `C:\\Users\\94503\\cc-alignment-capture\\trusted-eval`

它的设计目标是：

- 不与主仓库 git root 混用
- 不与 home 目录 project key 混用
- 可以反复复用
- 可以明确地加 trust / 撤销 trust

## 标准流程

### 1. 创建并标记 trusted capture 工作区

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-trusted-capture-workspace.ps1
```

这个脚本会做几件事：

- 创建独立目录
- 备份当前 [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json)
- 在 `projects` 下为该目录写入独立 project key
- 仅把这个目录标记为 `hasTrustDialogAccepted = true`
- 写入一个工作区说明文件 `CAPTURE_WORKSPACE.md`

如果需要撤销 trust：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\prepare-trusted-capture-workspace.ps1 -RevokeTrust
```

### 2. 先检查当前 GrowthBook 状态

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\inspect-growthbook-state.ps1 -CurrentPath "$env:USERPROFILE\cc-alignment-capture\trusted-eval"
```

重点看三项：

- `current_project_key`
- `current_project_trust`
- `cached_feature_count`

### 3. 开始 MITM 抓包

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-direct.ps1
```

### 4. 在 trusted 工作区里跑 probe

默认使用 blocking gate 探针：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\probe-growthbook-eval-direct.ps1
```

如果想对照 headless 最小请求：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\probe-growthbook-eval-direct.ps1 -Probe headless-hello
```

### 5. 结束抓包并读取结果

运行：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-direct-capture.ps1
python mitm\extract_signals.py mitm\direct.flows
```

如果要直接看 `/api/eval/*`：

```powershell
python mitm\extract_signals.py mitm\direct.flows 10 /api/eval/
```

如果要看 `/v1/messages`：

```powershell
python mitm\extract_signals.py mitm\direct.flows 10 /v1/messages
```

必要时再配合：

```powershell
Select-String -Path mitm\direct.log -Pattern '/api/eval/|v1/mcp_servers|claude_cli/bootstrap|oauth/account/settings|claude_code_grove|mcp-registry'
```

## 当前推荐 probe

### probe A: `remote-control`

- 路径：
  `claude remote-control`
- 目的：
  强制走 `checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge')`
- 价值：
  这是当前最接近“non-headless blocking gate”的现成探针
- 注意：
  如果 cwd 不 trusted，这条 probe 仍然可能拿不到 GrowthBook auth

### probe B: `headless-hello`

- 路径：
  `claude -p "hello"`
- 目的：
  对照最小真实请求面
- 价值：
  适合验证：
  - `/v1/messages`
  - `/api/event_logging/v2/batch`
- 注意：
  不能用它单独证明 `/api/eval/*` 已经消失

## 当前已验证结果

截至 2026-04-03，这条工作流已经确认了两件事：

1. trusted workspace 下的 `headless-hello` 已经能稳定抓到：
   - `POST /api/eval/sdk-*`
   - `GET /v1/mcp_servers`
   - `GET /api/claude_cli/bootstrap`
   - `GET /api/claude_code_grove`
   - `GET /api/oauth/account/settings`
   - `GET /mcp-registry/v0/servers`
   - `POST /v1/messages?beta=true`
2. trusted workspace 下的 `remote-control` 目前仍可能返回 `Remote Control is not yet enabled for your account.`，而且 MITM 文件可能为空

这意味着：

- trusted workspace + `headless-hello` 已经足够作为 `/api/eval/*` 的标准 direct probe
- `remote-control` 当前更适合被当作“bridge/entitlement 专项探针”，而不是 `/api/eval/*` 的唯一入口

## via-gateway 双通道对照

当目标不是“只看 direct”，而是要同时确认：

- 客户端直连 side channel 发了什么
- gateway 上游真正转发了什么

应该使用双通道抓包：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-dual-via-gateway.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-dual-via-gateway.ps1 -StopGateway
```

这里有一个关键点：

- `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY` 可以指向 direct MITM
- 但必须同时设置：
  `NO_PROXY=localhost,127.0.0.1`

否则客户端可能把 `https://localhost:9443` 这个 gateway 目标也一起送进 direct MITM，导致主请求链卡住，最后变成“side channel 看到了，gateway 主链没走通”的假假象。

### 当前已确认的双通道结果

在 trusted workspace + custom base URL + `NO_PROXY=localhost,127.0.0.1` 的当前最小请求里，必须再区分 auth mode：

#### external-auth-token

- gateway 上游稳定看到：
  - `POST /v1/messages?beta=true`
- direct side-channel MITM 看到：
  - `GET /v1/mcp_servers`
  - `GET /api/claude_cli/bootstrap`
  - `GET /api/claude_code_penguin_mode`
  - `GET /mcp-registry/v0/servers`
- 本轮没有看到：
  - `/api/eval/*`
  - `/api/event_logging/*`

#### managed-oauth

- gateway 上游稳定看到：
  - `POST /v1/messages?beta=true`
- direct side-channel MITM 看到：
  - `POST /api/eval/sdk-*`
  - `GET /mcp-registry/v0/servers`
- 当前这轮没有看到：
  - `/api/event_logging/*`

这说明：

- 最小 via-gateway 请求里，主链和 side channel 已经可以被明确拆开
- `ANTHROPIC_AUTH_TOKEN` 与 `CLAUDE_CODE_OAUTH_TOKEN` 不只是“不同写法”，而是会切换客户端的 subscriber / OAuth 叙事
- `/api/eval/*` 是否出现，已经确认会受 auth mode 直接影响
- `/api/event_logging/*` 仍然受额外 gating 或时序影响，不能因为某一轮缺失就认定为彻底不存在

## 维护规则

后面如果这条工作流有变化，必须同步更新：

- [growthbook-eval-investigation.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/growthbook-eval-investigation.md)
- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
- [telemetry-automation-plan.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/telemetry-automation-plan.md)

## 边界

这套 trusted capture workflow 的目的只有一个：

- 为 `/api/eval/*` 和 GrowthBook 研究创造干净、可重复的 trust 前置条件

它不是：

- 生产使用目录
- 测试者默认接入目录
- 号池或代理池的控制面实现
