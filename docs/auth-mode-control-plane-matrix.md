# Auth-Mode Control-Plane Matrix

## 目的

这份文档专门冻结一件事：

> 在 `trusted via-gateway` 研究路径下，不同 `auth mode` 会让哪些控制面请求出现、消失、或者改走旁路。

它不是 transport 总地图，也不是单次抓包日志。

它的职责只有两个：

1. 把 auth-mode-sensitive 的控制面行为收成一张稳定矩阵
2. 给后续版本升级提供一个可重复复跑、可快速补表的入口

## 适用范围

这份矩阵只讨论下面这条固定研究路径：

- workspace:
  `trusted capture workspace`
- traffic mode:
  `alignment mode`
- base URL:
  `ANTHROPIC_BASE_URL=https://localhost:9443`
- probe:
  `claude -p "hello"`
- direct MITM:
  开启
- `NO_PROXY`:
  `localhost,127.0.0.1`

也就是说，这份矩阵回答的是：

> 当主链已经走 gateway 时，first-party 控制面还会怎么动。

它不直接回答：

- `quiet mode` 下会不会被压掉
- 纯 direct CLI 时有没有这条路径
- gateway runtime 是否已经重写了某个字段

这些分别看：

- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)
- [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

## 当前基线

### 单次最小 probe

| Surface | external-auth-token direct | external-auth-token gateway | managed-oauth direct | managed-oauth gateway | 当前 owner | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `/v1/messages` | 否 | 是 | 否 | 是 | `gateway-mainline` | 主推理链两种 auth mode 都稳定经过 gateway |
| `/api/eval/sdk-*` | 否 | 否 | 是 | 否 | `direct-host-side-channel` | 这条链对 auth mode 敏感，当前只在 `managed-oauth` 下出现 |
| `/api/claude_cli/bootstrap` | 是 | 否 | 否 | 否 | `direct-host-side-channel` | 当前最小 via-gateway 路径里，只在 `external-auth-token` 下出现 |
| `/api/claude_code_penguin_mode` | 是 | 否 | 否 | 否 | `direct-host-side-channel` | 当前最小 via-gateway 路径里，只在 `external-auth-token` 下出现 |
| `/v1/mcp_servers` | 是 | 否 | 否 | 否 | `direct-host-side-channel` | 当前最小 via-gateway 路径里，只在 `external-auth-token` 下出现 |
| `/mcp-registry/v0/servers` | 是 | 否 | 是 | 否 | `direct-host-side-channel` | 两种 auth mode 下都能出现，但仍不经过 gateway 上游 |
| `/api/oauth/account/settings` | 否 | 否 | 否 | 否 | `not-observed` | 当前 via-gateway 最小 probe 里还没重新看到，不能据此认定已消失 |
| `/api/claude_code_grove` | 否 | 否 | 否 | 否 | `not-observed` | 当前 via-gateway 最小 probe 里还没重新看到，不能据此认定已消失 |
| `/api/event_logging/v2/batch` | 否 | 否 | 否 | 否 | `not-observed` | 单次最小 probe 不足以稳定触发 |

### timing 补充：managed-oauth 重复 probe

| Surface | managed-oauth direct (`RepeatCount=2`) | managed-oauth gateway (`RepeatCount=2`) | 当前 owner | 结论 |
| --- | --- | --- | --- | --- |
| `/api/event_logging/v2/batch` | 是 | 否 | `direct-host-side-channel` | 这条链不是“不发”，而是当前最小单次 probe 下更容易被时序掩盖 |

## 为什么要单独冻成矩阵

如果不把这块单独收出来，后面很容易反复犯 3 类错误：

1. 把 auth mode 变化误判成 gateway rewrite 缺口
2. 把 direct side-channel 误判成 `ANTHROPIC_BASE_URL` 没生效
3. 把 timing-sensitive 请求误判成“CLI 版本删掉了”

这就是为什么这份文档不和 [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md) 混写。

`transport-surface-map` 负责全局 ownership。

这份矩阵只负责：

- 同一条 via-gateway 路径下
- 换 auth mode 后
- 控制面行为怎么变化

## 快速复跑流程

### 1. external-auth-token 单次最小 probe

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-dual-via-gateway.ps1 -AuthMode external-auth-token
powershell -ExecutionPolicy Bypass -File .\scripts\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode external-auth-token
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-dual-via-gateway.ps1 -StopGateway
python mitm\summarize_control_plane_matrix.py --mode-label external-auth-token-r1
```

### 2. managed-oauth 单次最小 probe

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-dual-via-gateway.ps1 -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-dual-via-gateway.ps1 -StopGateway
python mitm\summarize_control_plane_matrix.py --mode-label managed-oauth-r1
```

### 3. managed-oauth 重复 probe

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-dual-via-gateway.ps1 -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode managed-oauth -RepeatCount 2
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-dual-via-gateway.ps1 -StopGateway
python mitm\summarize_control_plane_matrix.py --mode-label managed-oauth-r2
```

## 推荐归档方式

为了避免下次矩阵被新抓包覆盖，推荐每轮把结果归档到：

```text
artifacts/
  captures/
    auth-matrix/
      2026-04-03/
        external-auth-token-r1/
          dual-direct.log
          dual-gateway.log
        managed-oauth-r1/
          dual-direct.log
          dual-gateway.log
        managed-oauth-r2/
          dual-direct.log
          dual-gateway.log
```

当前不要求自动归档脚本先落地，但后续半自动化时应沿这个结构走。

## 结构化目标清单

矩阵脚本使用的 endpoint 清单在：

- [control_plane_targets.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/control_plane_targets.json)

矩阵摘要脚本在：

- [summarize_control_plane_matrix.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/summarize_control_plane_matrix.py)

这两个文件的职责分开：

- `control_plane_targets.json`
  维护要追哪些面
- `summarize_control_plane_matrix.py`
  维护怎么从 capture log 里快速出表

这样以后新增 side channel 时，不需要重写整份文档，只需要：

1. 往 `control_plane_targets.json` 补一项
2. 重新跑 capture
3. 回写矩阵和 alignment log

## 更新规则

每次 auth-mode 行为面有新变化，按这个顺序更新：

1. 先更新这份矩阵文档
2. 再更新 [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
3. 再写入 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
4. 如果 probe 条件变了，再补 [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)

## 当前结论

这份矩阵目前已经把一件关键事实冻结住了：

> 在 `trusted via-gateway` 路径下，`auth mode` 不是小变量，而是直接决定 `/api/eval/*`、`bootstrap`、`penguin`、`MCP`、`event_logging` 行为面的一级变量。

所以以后只要控制面差异重新出现，不要先改 rewrite。

先回到这份矩阵，确认它到底是：

- `traffic mode` 问题
- `auth mode` 问题
- transport ownership 问题
- 还是 runtime rewrite 问题
