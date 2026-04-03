# Event Logging Threshold Workflow

## 目的

这份文档只解决一个问题：

> `managed-oauth` 下的 `/api/event_logging/v2/batch`，到底在什么最小 probe 条件下才会稳定出现。

它不是 transport 总地图，也不是 auth-mode 控制面总矩阵。

它专门负责：

1. 冻结 `event_logging` 的触发阈值研究方法
2. 把“单次没看到”与“这条链真的没发”严格区分开
3. 把 `RepeatCount` 和 `DelayMilliseconds` 的组合效应收成可复跑矩阵

## 为什么要单独做

当前已知事实是：

- `event_logging` 仍然是 direct side-channel
- 单次最小 `managed-oauth` probe 里，可能看不到它
- 它曾在较高重复次数下重新出现，但低重复次数并不稳定

这说明：

- 它不是简单的 on/off 开关
- 它至少受：
  - 批处理时序
  - probe 次数
  - query 间隔
  影响

参考源码也支持这个判断：

- [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)
- [firstPartyEventLoggingExporter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLoggingExporter.ts)

其中明确写了：

- 默认按 `BatchLogRecordProcessor` 批量导出
- 触发条件至少包括：
  - 时间窗口
  - 批量大小
  - shutdown / forceFlush

所以如果继续手工跑：

- `hello`
- 再跑一次
- 改一改 delay

很快就会失去可维护性。

## 推荐脚本

统一使用：

- [sweep-event-logging-threshold.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-threshold.ps1)
- [sweep-event-logging-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-matrix.ps1)

其中：

- `sweep-event-logging-threshold.ps1`
  负责单个 `DelayMilliseconds` 下的 `RepeatCount` sweep
- `sweep-event-logging-matrix.ps1`
  负责把多个 `DelayMilliseconds` 串起来，输出二维矩阵

阈值脚本会为每个 `RepeatCount` 自动执行：

1. 启动 trusted `via-gateway` 双通道 capture
2. 运行对应次数的最小 probe
3. 结束 capture
4. 调用矩阵摘要脚本
5. 输出 `event_logging / eval / messages` 的结果表

## 最小用法

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1
```

默认等价于：

- `AuthMode=managed-oauth`
- `RepeatCounts=1,2,3`
- `DelayMilliseconds=250`
- 并且现在已经兼容 PowerShell 的 `-RepeatCounts 1,2` 这种逗号写法

### 二维矩阵

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-matrix.ps1 -RepeatCounts 1,2,3 -DelayValues 0,250,1000
```

默认矩阵脚本会：

1. 对每个 `DelayMilliseconds` 调一次阈值脚本
2. 保留每个 `RepeatCount` 的结构化结果
3. 输出最终合并矩阵

如果需要把结果交给后续脚本或归档系统处理，可以额外加：

```powershell
-JsonPath artifacts\captures\event-logging-matrix\current-matrix.json
```

## 指定参数

### 只测 1 和 2 次

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1 -RepeatCounts 1,2
```

### 调整 probe 间隔

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1 -RepeatCounts 1,2,3 -DelayMilliseconds 1000
```

### 归档每轮 capture

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-threshold.ps1 -ArchiveRuns
```

归档目录默认会落到：

```text
artifacts/captures/event-logging-threshold/
```

矩阵脚本默认归档根目录则建议落到：

```text
artifacts/captures/event-logging-matrix/
```

## 输出解释

脚本输出一张表，重点看这些列：

- `RepeatCount`
- `EventDirectCount`
- `EventGatewayCount`
- `EventOwner`
- `EvalDirectCount`
- `MessagesGatewayCount`

判断规则：

- `EventDirectCount > 0` 且 `EventGatewayCount = 0`
  说明 `event_logging` 仍然是 direct side-channel
- `RepeatCount=1` 为 0，但 `RepeatCount=2` 变成正数
  说明最小单次 probe 不足以稳定触发
- `MessagesGatewayCount > 0`
  说明主链 capture 本身是健康的

## 当前经验基线

### 2026-04-03 单轴基线

固定条件：

- workspace:
  `C:\Users\94503\cc-alignment-capture\trusted-eval`
- auth mode:
  `managed-oauth`
- delay:
  `250ms`
- probe:
  `claude -p "hello"`

结果：

| RepeatCount | EventDirectCount | EvalDirectCount | 结论 |
| --- | --- | --- | --- |
| `1` | `0` | `2` | `event_logging` 未出现，`eval` 稳定存在 |
| `2` | `0` | `4` | `event_logging` 仍未出现，说明 `2` 不是稳定阈值 |
| `3` | `2` | `6` | `event_logging` 已重新出现 |
| `5` | `2` | `10` | `event_logging` 继续出现 |

当前可冻结的判断是：

- `RepeatCount=1` 和 `2` 在当前机器/账号/延迟下都不稳定
- `RepeatCount=3` 已经足以在当前环境里重现 `event_logging`
- `RepeatCount=2` 过去曾经抓到过一次，所以它不是“绝对不可能”，只是当前不能当成稳定阈值

这意味着当前最合理的研究表述不是：

- `2` 次就够

而是：

- `3` 次是当前已验证的可复现下界
- `2` 次仍属于偶发命中区间

### 2026-04-03 二维矩阵复核

固定条件：

- workspace:
  `C:\Users\94503\cc-alignment-capture\trusted-eval`
- auth mode:
  `managed-oauth`
- probe:
  `claude -p "hello"`
- 结构化证据：
  [event_logging_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/event_logging_matrix_2026-04-03.json)

| DelayMilliseconds | RepeatCount | EventDirectCount | EvalDirectCount | 当前结论 |
| --- | --- | --- | --- | --- |
| `0` | `1` | `0` | `2` | 单次仍不足以触发 |
| `0` | `2` | `1` | `4` | `2` 次可命中，但不是所有 delay 都命中 |
| `0` | `3` | `3` | `6` | 稳定出现，且会出现多批 `event_logging` |
| `250` | `1` | `0` | `2` | 单次仍不足以触发 |
| `250` | `2` | `0` | `4` | 当前明确 miss，说明 `2` 次存在 delay 敏感性 |
| `250` | `3` | `1` | `6` | 稳定出现 |
| `1000` | `1` | `0` | `2` | 单次仍不足以触发 |
| `1000` | `2` | `1` | `4` | `2` 次再次命中，进一步证明它是 delay-sensitive |
| `1000` | `3` | `1` | `6` | 稳定出现 |

这轮矩阵把原来的“一维经验结论”升级成了更精确的事实：

- `RepeatCount=1`
  在当前测试的 `0 / 250 / 1000ms` 三个 delay 上都不会触发 `event_logging`
- `RepeatCount=2`
  不是简单的“不稳定”，而是明确存在 `DelayMilliseconds` 敏感性：
  - `0ms` 命中
  - `250ms` miss
  - `1000ms` 命中
- `RepeatCount=3`
  是当前已验证、跨这三组 delay 都成立的最小稳定下界

所以当前最合理的冻结说法已经不再是：

- `3` 次在 `250ms` 下能复现

而是：

- `3` 次是当前跨 `0 / 250 / 1000ms` 都成立的最小稳定下界
- `2` 次属于 delay-sensitive 命中区间，不能写成稳定阈值

## 当前使用建议

当前阶段先优先扫这三组：

1. `RepeatCount=1`
2. `RepeatCount=2`
3. `RepeatCount=3`

再优先补这三组 delay：

4. `DelayMilliseconds=0`
5. `DelayMilliseconds=250`
6. `DelayMilliseconds=1000`

只有这两组轴都还不能解释现象，再去改：

- 具体 probe 类型
- workspace 初始状态
- 更长的 post-run 等待

## 维护规则

每次用这个工作流得出新阈值结论，按这个顺序更新：

1. [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
2. [auth-mode-control-plane-matrix.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-mode-control-plane-matrix.md)
3. [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
4. [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

## 当前结论

目前这条线还没有完全收尾。

但从现在开始，`event_logging` 的阈值研究已经不再依赖手工重复命令，而是有了固定脚本、固定输出和固定归档路径。
