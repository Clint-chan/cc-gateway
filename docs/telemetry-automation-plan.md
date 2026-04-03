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

## 自动化链路

### 第一步：采集

采集两组流量：

1. direct CLI
2. via gateway

都必须固定：

- 同一台机器
- 同一代理出口
- 同一 Claude Code 版本
- 同一最小测试提示词

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

1. custom base URL 场景下，CLI 不一定会稳定发送全部 first-party 遥测通道
2. 有些路径需要特定交互场景才会触发
3. `cch` 这类 native attestation 无法靠 Node 网关自动补齐

## 结论

后续正确方向不是“自动胡乱修”，而是：

- 自动抓
- 自动抽
- 自动比
- 人工定策略
- 再把策略落实到 gateway 和文档
