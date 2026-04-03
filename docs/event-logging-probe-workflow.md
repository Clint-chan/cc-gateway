# Event Logging Probe Workflow

## 目的

这份文档只回答一个更细的问题：

> 在 `managed-oauth` 的 trusted `via-gateway` 路径下，不同 `--print` probe 形态会不会改变 `/api/event_logging/v2/batch` 的触发阈值。

它不是 repeat/delay 阈值总文档，而是专门补 `probe-type` 这一轴。

## 为什么要单独冻出来

现在我们已经知道：

- `event_logging` 是 direct side-channel
- `RepeatCount` 和 `DelayMilliseconds` 会影响它是否出现

但这还不足以回答另一个高价值问题：

> 如果只是把同一条 `claude -p` 请求换成不同输出路径，阈值会不会变化？

这一步很重要，因为它能把“prompt 内容差异”排除掉，只留下更干净的变量：

1. 输出格式
2. 生命周期
3. 非交互路径里的 IO 行为

参考源码表明，这个方向有研究价值：

- [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts)
- [gracefulShutdown.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/gracefulShutdown.ts)

当前已确认：

- `--print` 结束时都会走同一套 `gracefulShutdownSync()`
- 但 `text / json / stream-json` 会走不同的输出路径
- `stream-json` 还要求 `--verbose`

所以 probe-type 差异不该再被当成“只是输出样式不同”。

## 当前纳入矩阵的 probe

统一由：

- [probe-trusted-via-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-trusted-via-gateway.ps1)

负责执行。当前支持这三种 probe：

1. `hello`
   对应：
   `claude -p "hello"`
2. `hello-json-verbose`
   对应：
   `claude -p --output-format json --verbose "hello"`
3. `hello-stream-json-verbose`
   对应：
   `claude -p --output-format stream-json --verbose "hello"`

这三种 probe 的共同点是：

- 都是 headless `--print`
- 都是同一个 prompt
- 都走同一条 gateway 主链

差异只保留在：

- 输出格式
- verbose 行为
- 进程输出路径

## 推荐脚本

统一使用：

- [sweep-event-logging-probe-matrix.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/sweep-event-logging-probe-matrix.ps1)

它会：

1. 固定 auth mode 和 delay
2. 逐个切换 probe type
3. 在每个 probe 下跑一组 `RepeatCount`
4. 输出一张 probe-type 矩阵

## 最小用法

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-probe-matrix.ps1 -AuthMode managed-oauth -RepeatCounts 1,2 -DelayMilliseconds 250
```

如果需要结构化结果：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\sweep-event-logging-probe-matrix.ps1 -AuthMode managed-oauth -RepeatCounts 1,2 -DelayMilliseconds 250 -JsonPath artifacts\captures\event-logging-probe-matrix\current-probe-matrix.json
```

## 2026-04-03 当前基线

固定条件：

- auth mode:
  `managed-oauth`
- delay:
  `250ms`
- repeat counts:
  `1,2`
- 结构化证据：
  [event_logging_probe_matrix_2026-04-03.json](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/event_logging_probe_matrix_2026-04-03.json)

| Probe | RepeatCount | EventDirectCount | EvalDirectCount | 当前结论 |
| --- | --- | --- | --- | --- |
| `hello` | `1` | `0` | `2` | 默认 text 输出下，单次仍不触发 |
| `hello` | `2` | `0` | `4` | 默认 text 输出下，`2` 次在 `250ms` 仍然 miss |
| `hello-json-verbose` | `1` | `0` | `2` | `json+verbose` 仍不足以把阈值压到单次 |
| `hello-json-verbose` | `2` | `2` | `4` | `json+verbose` 已经能把阈值压到 `2` 次 |
| `hello-stream-json-verbose` | `1` | `3` | `2` | `stream-json+verbose` 单次就能稳定触发 |
| `hello-stream-json-verbose` | `2` | `2` | `4` | `2` 次继续稳定触发 |

## 当前冻结结论

当前最重要的结论不是“多抓到几条包”，而是：

1. 不同 `--print` probe 并不等价
2. `probe-type` 会直接改变 `event_logging` 的触发阈值
3. 在 `DelayMilliseconds=250` 这个原本最容易 miss 的条件下：
   - `hello`
     `RepeatCount=2` 仍 miss
   - `hello-json-verbose`
     `RepeatCount=2` 已命中
   - `hello-stream-json-verbose`
     `RepeatCount=1` 就命中

所以当前更准确的说法应该是：

- `event_logging` 不只是 `repeat/delay-sensitive`
- 它还是明确的 `probe-type-sensitive`

## 对方法论的含义

以后只要 `event_logging` 重新消失，不要立刻下结论说：

- upstream 改了
- gateway 没配好
- 代理没走通

先回到这三个轴：

1. `RepeatCount`
2. `DelayMilliseconds`
3. `Probe`

这三个轴没声明清楚，任何“这条面出现/消失了”的结论都不够稳。

## 推荐使用顺序

当前建议先按这个顺序排查：

1. 先跑 [event-logging-threshold-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/event-logging-threshold-workflow.md)
   锁住 repeat/delay
2. 再跑这份 probe workflow
   看输出路径会不会进一步降低阈值

不要反过来。否则会把 probe 差异和 delay 差异混在一起。

## 当前结论

截至 2026-04-03，这条线已经从：

- “event_logging 好像有时会发”

推进到：

- “event_logging 的触发条件至少受 `repeat / delay / probe-type` 三个轴共同影响”

这已经足够支撑后续半自动化继续往前走。下一阶段如果还要深挖，优先级应该低于 `/api/eval/*` 字段矩阵和 Docker 回补验证。
