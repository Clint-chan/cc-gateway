# 遥测对齐半自动化路线

## 目标

后期把“最新遥测抓取、对比、提醒更新”做成半自动化。

这里说的半自动化，不是自动改生产逻辑，而是自动完成以下流程：

1. 抓取最新 direct CLI 流量
2. 抓取最新 gateway 上游流量
3. 抽取关键字段
4. 生成差异报告
5. 把需要人工决策的项标出来

## 预期产物

每天或每次版本升级后，自动生成：

- `mitm/direct-YYYYMMDD.flows`
- `mitm/direct-YYYYMMDD.log`
- `mitm/gateway-YYYYMMDD.flows`
- `mitm/gateway-YYYYMMDD.log`
- `mitm/diff-YYYYMMDD.md`
- `artifacts/reports/telemetry-YYYYMMDD.md`

## 自动化链路

### 第一步：采集

采集两组流量：

1. direct CLI
2. via gateway

这里必须先声明采集模式：

1. `quiet mode`
2. `alignment mode`

都必须固定：

- 同一台机器
- 同一代理出口
- 同一 Claude Code 版本
- 同一最小测试提示词
- 采集结束后必须先停止 `mitmdump`，再读取 `.flows`
  否则 Windows 下经常出现流量尚未 flush 到文件的问题

如果目标是对齐 telemetry，而不是只验证主推理链：

- 必须使用 `alignment mode`
- 不要设置 `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`
- 否则 `GrowthBook` 和 `1P event logging` 根本不会发

默认研究环境规则：

- 优先使用本地 `npm start`
- Docker 只用于部署验证，不作为默认抓包基线
- 只有在明确研究容器层 transport 差异时，才把 Docker 纳入 primary diff

原因见 [research-environment-policy.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/research-environment-policy.md)。

如果目标是做 trusted `via-gateway` 双通道：

- 客户端可以继续把 `HTTP_PROXY / HTTPS_PROXY / ALL_PROXY` 指向 direct MITM
- 但必须同时设置：
  `NO_PROXY=localhost,127.0.0.1`
- 否则 `https://localhost:9443` 这条 gateway 主链也可能被错误送进 direct MITM，导致主请求挂起

### 第二步：抽取

从抓包中抽取固定字段：

- headers
- `metadata.user_id`
- billing header
- `/api/eval/*` attributes
- `/api/event_logging/*` env/process/core
- 新出现的路径

### 第三步：对比

分三类输出：

1. 已对齐
2. 可自动修正
3. 需要人工决策

### 第四步：落文档

自动报告出来后，人工确认并更新：

- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)

## 推荐的脚本拆分

后面可以落成这些脚本：

- `scripts/capture-direct.ps1`
- `scripts/capture-gateway.ps1`
- `scripts/parse-mitm.ts`
- `scripts/diff-telemetry.ts`
- `scripts/report-telemetry.ts`

当前仓库里已经先落了最小本地版本：

- [capture-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-direct.ps1)
- [capture-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-gateway.ps1)
- [finalize-direct-capture.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-direct-capture.ps1)
- [finalize-gateway-capture.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/finalize-gateway-capture.ps1)
- [prepare-trusted-capture-workspace.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/prepare-trusted-capture-workspace.ps1)
- [probe-growthbook-eval-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/probe-growthbook-eval-direct.ps1)
- [extract_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/extract_signals.py)
- [diff_signals.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/diff_signals.py)
- [render_telemetry_report.py](/C:/Users/94503/Documents/GitHub/cc-gateway/mitm/render_telemetry_report.py)

其中：

- `/api/eval/*` 的 direct 基线优先走 [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)
- `extract_signals.py` 已支持按 URL substring 过滤，便于自动脚本直接抽：
  - `/api/eval/`
  - `/v1/messages`
  - `/api/event_logging/`

当前最小维护报告命令：

```powershell
python mitm/render_telemetry_report.py --output artifacts/reports/telemetry-YYYYMMDD.md
```

## 自动任务触发条件

推荐两种触发：

### 版本触发

当检测到：

- `claude --version` 变化
- `User-Agent` 里的版本变化

就自动跑一轮抓取

### 定时触发

每天固定时间跑一轮最小请求，检查是否有：

- 新 header
- 新 beta
- 新 endpoint
- 新 body 字段

## 自动化边界

不建议自动做的事：

- 自动改写生产配置
- 自动改写 persona
- 自动删除字段
- 自动更新文档结论

这些都应该保留人工复核。

## 当前阻塞点

1. 如果误用 `quiet mode`，GrowthBook 和 1P event logging 会被直接关闭
2. custom base URL 场景下，CLI 不一定会稳定发送全部 first-party 遥测通道
3. 有些路径需要特定交互场景才会触发
4. `cch` 这类 native attestation 无法靠 Node 网关自动补齐
5. custom base URL 会让一部分 only-first-party 控制面路径直接失去资格，自动 diff 时必须区分“未发送”和“发送后不一致”
6. 一部分 side channel 默认并不跟 `ANTHROPIC_BASE_URL` 走，自动化采集必须结合 [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md) 判断采集入口
7. 当前 headless 最小请求已确认会发 `event_logging`，但还没有稳定触发 `/api/eval/*`
8. local-jsx blocking gate 命令还受 workspace trust 影响，当前 cwd 如果没 trust，不能把“没抓到 `/api/eval/*`”直接当成路径缺失

## 当前推荐的采集前检查

在继续追 `/api/eval/*` 之前，先运行：

- [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)

先确认三件事：

1. 当前 cwd trust 是否成立
2. 是否已经存在较大的 `cachedGrowthBookFeatures`
3. 当前关键 gate 的磁盘缓存值是什么

## 结论

后续正确方向不是“自动胡乱修”，而是：

- 自动抓
- 自动抽
- 自动比
- 自动标记当前抓包属于 quiet 还是 alignment
- 人工定策略
- 再把策略落实到 gateway 和文档
