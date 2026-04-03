# Status And Exit Criteria

## 目的

这份文档回答两个现实问题：

1. 我们现在到底做到哪了
2. 这一阶段什么时候算“可以收尾”

这里说的“收尾”，不是指项目永久完成，而是指：

- transport 和 telemetry 研究先收敛到一个可交付的 `v1`
- 后续转入“持续维护和版本跟踪”
- 再把精力投入前后端平台化

## 当前阶段定位

当前项目最准确的定位是：

> 一个已经能用的 gateway 测试版 + 一套逐渐成熟的 telemetry/transport 研究框架

它还不是：

- 完整的全链路安全反代平台
- 完整的多账号管理系统
- 已产品化的前后端平台

## 当前完成度

### 1. Gateway 可用性

完成度：`75%`

已完成：

- 本机 Node 运行已经稳定
- Claude Code 可以通过 gateway 正常请求
- `.claude.json` 接入路径已经明确
- `quiet mode` 已经适合作为对外默认模式
- `alignment mode` 已经能作为研究模式稳定复现主链

未完成：

- Docker 还没重新打通验证
- 证书与部署方式还偏本地测试
- 还没有做持续运行和多人压测

### 2. Transport / Telemetry 事实层

完成度：`84%`

已完成：

- `/v1/messages` 主链基本对齐
- `quiet mode` 和 `alignment mode` 已经拆开
- `trusted capture workspace` 已落地
- `/api/eval/*` 已在 trusted workspace 的 `headless-hello` 下重新实抓到
- `bootstrap / grove / account settings / MCP control plane` 已在 trusted direct 场景下抓到
- `1P event logging` 已确认在 `alignment mode` 下会直连 first-party
- trusted `via-gateway` 双通道 workflow 已落地并跑通
- 已确认 `via-gateway` 最小请求里：
  - gateway 上游稳定看到 `/v1/messages`
  - `external-auth-token` 下 direct side-channel 稳定看到 `/v1/mcp_servers`、`/api/claude_cli/bootstrap`、`/api/claude_code_penguin_mode`、`/mcp-registry`
  - `managed-oauth` 下 direct side-channel 已重新看到 `/api/eval/sdk-*`
  - `managed-oauth + RepeatCount=2` 下 direct side-channel 已重新看到 `/api/event_logging/v2/batch`
- 已确认 `NO_PROXY=localhost,127.0.0.1` 是双通道 workflow 的硬条件
- 已确认 `auth mode` 是独立于 `traffic mode` 的第二个高优先级变量

未完成：

- trusted `via-gateway` 对照还没把 `event_logging` 的最小稳定触发条件完全收干净
- `/api/eval/*` 在 gateway 场景下已经重新确认为 direct side-channel，但相关字段矩阵还没完全冻结
- `event_logging` 在 trusted workflow 下的时序和 probe 阈值还没彻底验掉
- `remote-control` 为什么会在更早阶段结束，还没拆完

### 3. 方法论与可维护性

完成度：`92%`

已完成：

- 有 transport ownership 地图
- 有指纹目录
- 有逐次修复日志
- 有 GrowthBook 专项调查文档
- 有 trusted capture workflow
- 有 trusted `via-gateway` 双通道 workflow
- 有 auth-mode-sensitive 控制面矩阵文档和结构化目标清单
- 有半自动化路线图
- 有仓库布局规范
- 有 URL 过滤提取和双通道 capture 脚本

未完成：

- 自动提取与 diff 还只是最小版本
- 还没有形成完整的日常采集报告模板
- 还没有把 Docker 场景纳入同一套研究工作流

### 4. 产品化准备

完成度：`20%`

已完成：

- 架构路线图
- 数据模型草案
- API 设计草案
- 仓库结构演进规则

未完成：

- `apps/gateway`
- `admin-api`
- `admin-web`
- 数据库
- 账号池
- 代理池
- 控制面实现

## 当前阶段最重要的结论

### 结论一：quiet mode 已经可以作为对外默认模式

这意味着：

- 对外测试和小范围使用已经可以继续推进
- 当前不需要等待遥测研究 100% 结束，才允许别人用 gateway

### 结论二：alignment mode 仍然是研究模式，不是生产模式

这意味着：

- 研究结果不能直接拿来当生产配置
- 旁路和 side channel 仍然需要逐条归属

### 结论三：`/api/eval/*` 这条链已经从“怀疑存在”进入“确定存在，但未完全归属”

这意味着：

- 这块不再是“有没有”的问题
- 现在的问题是：
  - 它在 gateway 场景下怎么走
  - 我们能统一多少
  - 不能统一的部分是否要靠 quiet mode 或网络层压制

## 当前阶段的收尾定义

只有满足下面这组条件，当前这块 transport/telemetry 工作才算 `v1 收尾`。

### 必须完成

1. 跑完 trusted `direct` vs trusted `via-gateway` 对照

至少覆盖：

- `/v1/messages`
- `/api/eval/*`
- `/api/claude_cli/bootstrap`
- `/api/oauth/account/settings`
- `/api/claude_code_grove`
- `/v1/mcp_servers`
- `mcp-registry`
- `/api/event_logging/v2/batch`

2. 为每条路径冻结 ownership

每条路径必须归到这三类之一：

- `gateway-mainline`
- `direct-host-side-channel`
- `gated-surface`

3. 为每条高风险路径冻结策略

每条路径必须明确属于：

- `统一改写`
- `默认压制`
- `允许直连但记风险`

4. 固化一套可重复研究流程

至少包括：

- trusted capture workspace
- direct capture
- gateway capture
- URL 过滤提取
- 差异记录回写

5. Docker 路径重新打通一次

不是为了产品化，而是为了证明研究结论不只依赖“本机裸跑”

### 可以暂缓

这些不影响当前阶段收尾：

- 前端管理界面
- 数据库
- 账号池
- 代理池
- 控制面 API
- 多租户与 RBAC

## 还差哪些任务

按优先级看，还差四块：

### T1. trusted via-gateway 对照

价值最高。

目标：

- 用 trusted workspace + gateway + MITM
- 跑完 `managed-oauth` 与 `external-auth-token` 两条接入模型
- 直接回答“这些链路在 gateway 场景下到底怎么走”

当前进展：

- 主链与一部分 direct side channel 已拆开
- `/api/eval/*` 已确认会受 auth mode 直接影响
- auth-mode-sensitive 控制面矩阵已经单独冻结成资产
- 当前剩余重点只剩：
  - `/api/event_logging/*` 的最小稳定触发矩阵
  - auth-mode-sensitive 控制面矩阵继续补全未观察到的行

### T2. event logging 的 trusted 时序复抓

目标：

- 弄清在 trusted workflow 下，`event_logging` 为什么这次没有同步出现
- 判断是：
  - 进程时序
  - mode gating
  - probe 差异
  - 还是 CLI 版本行为变化

### T3. remote-control 早退路径拆清

目标：

- 解释为什么 `remote-control` 会提前结束
- 把这条 probe 从主流程中降级或重新定位

### T4. Docker 验证回补

目标：

- 用已经稳定的配置和结论重新验证容器场景
- 不再让 Docker 成为单独一套逻辑

## 工期评估

如果后续不再扩 scope，只专注把当前这块收尾到 `v1`，我的判断是：

### 乐观情况

`2-3` 个高质量工作轮次

前提：

- trusted `via-gateway` 很快复现
- `/api/eval/*` 在 gateway 场景下路径清晰
- Docker 不再卡在外部网络问题

### 正常情况

`3-5` 个工作轮次，约 `1-3` 天的连续推进

这是当前最现实的估计。

### 悲观情况

如果 upstream 还有新的隐藏 side channel，或者 Docker/代理链再出新变量，可能会拉到 `1` 周左右。

但即使这样，也不应该继续扩需求，而应该：

- 先冻结 `v1 边界`
- 先把 transport ownership 和生产默认模式定住

## 何时转入下一阶段

只有当 `v1 收尾标准` 满足后，才建议正式进入：

- `apps/gateway` 结构迁移
- `admin-api`
- `admin-web`
- 账号池与代理池

否则会出现一个问题：

- 上层平台做得越来越像产品
- 底层 transport 事实却还在变

这会导致后面重构成本非常高。

## 当前判断

如果按阶段来讲，我们现在已经不在“能不能用”的阶段，而是在：

> `收口 transport 事实、冻结 v1 边界` 的阶段

换句话说：

- 不是从 0 到 1
- 是从 `0.78` 到 `1.0`

这个阶段最重要的不是继续铺功能，而是：

1. 把剩余 side channel 逐条归属
2. 把默认生产模式定死
3. 把研究流程标准化
4. 然后及时收尾
