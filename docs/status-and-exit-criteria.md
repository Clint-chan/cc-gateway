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

完成度：`85%`

已完成：

- 本机 Node 运行已经稳定
- Claude Code 可以通过 gateway 正常请求
- `.claude.json` 接入路径已经明确
- `quiet mode` 已经适合作为对外默认模式
- `alignment mode` 已经能作为研究模式稳定复现主链
- Docker runtime 侧的 host alias、日志落盘和代理约定已经冻结
- `.env + config.yaml` 的双层部署模型已经落地
- 本机 `npm` 和 Docker Compose 的 `/_health` 已重新验证通过

未完成：

- 证书与部署方式还偏本地测试
- 还没有做持续运行和多人压测

### 2. Transport / Telemetry 事实层

完成度：`95%`

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
- `managed-oauth` 的 threshold sweep 已确认：
    - `RepeatCount=1` 在 `0 / 250 / 1000ms` 都不会触发
    - `RepeatCount=2` 已确认为 delay-sensitive 命中区间
    - `RepeatCount=3` 是当前跨 `0 / 250 / 1000ms` 的稳定下界
- `managed-oauth` 的 probe matrix 已确认：
    - `hello` 在 `DelayMilliseconds=250` 下，`RepeatCount=2` 仍 miss
    - `hello-json-verbose` 在同样条件下已能命中
    - `hello-stream-json-verbose` 已能把阈值压到 `RepeatCount=1`
- 已确认 `NO_PROXY=localhost,127.0.0.1` 是双通道 workflow 的硬条件
- 已确认 `auth mode` 是独立于 `traffic mode` 的第二个高优先级变量
- 已确认 Grove / account settings 在当前 via-gateway 两种 auth mode 下属于 `auth-model-suppressed`，不是简单的 “not-observed”
- 已确认 `remote-control` 当前应视为 bridge entitlement probe，而不是通用 `/api/eval/*` probe
- 已冻结 `/api/eval/*` 字段矩阵：
  - `subscriptionType` / `rateLimitTier` / `firstTokenTime` 属于 `auth-model-sensitive`
  - `apiBaseUrlHost` 属于 `transport-sensitive`
  - `sessionId` 属于 `session-runtime`
  - 主体 identity/account 字段在当前两个基线上保持稳定

未完成：

- bridge feature gate 本身仍然没有放量，所以 `remote-control` 仍不适合作为正向能力验证面
- `event_logging` 的 current findings 已足够冻结到 `repeat / delay / probe-type` 三轴；更深的 interactive / resume 类 probe 暂不影响当前 v1 收尾
- Docker 回补已经完成；当前剩下的是把它继续保持成和本机 runtime 同步演进，而不是再分叉出第二套逻辑

### 3. 方法论与可维护性

完成度：`99%`

已完成：

- 有 transport ownership 地图
- 有指纹目录
- 有逐次修复日志
- 有 GrowthBook 专项调查文档
- 有 trusted capture workflow
- 有 trusted `via-gateway` 双通道 workflow
- 有 auth-mode-sensitive 控制面矩阵文档和结构化目标清单
- 有 event_logging 阈值扫面脚本和专项 workflow
- 有 `RepeatCount x DelayMilliseconds` 的矩阵 sweep 工作流和结构化结果
- 有 `probe-type` 矩阵工作流和结构化结果
- 有 `/api/eval/*` 字段目标清单、提取脚本和结构化基线结果
- 有最小遥测维护报告生成器
- 有最小外层维护脚本入口
- 有半自动化路线图
- 有仓库布局规范
- 有 URL 过滤提取和双通道 capture 脚本

未完成：

- 自动提取与 diff 还只是最小版本
- 还没有把维护报告接进定时调度和版本触发链
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

### 5. 源码理解与产品成熟度

完成度：`分层可用，但不求伪完整`

已完成：

- 对 Claude Code 与当前 gateway 真正相关的 transport/auth/telemetry 面已经形成“够用且可持续跟进”的理解
- 对当前本项目 runtime 的主路径已经理解到足以继续重构和演进
- 对项目背景的理解已经足够支撑当前架构决策
- 产品成熟度已经能支持内部测试和对外小范围试用

未完成：

- Claude Code 全量源码并未也不需要在当前阶段“彻底读完”
- 平台层源码还不存在，因此“完整吃透未来平台代码”本身不是当前任务
- 产品成熟度仍停留在 `gateway beta / platform alpha`

## 当前阶段最重要的结论

当前架构优先级顺序已经冻结在：

1. 维护环路自动化
2. 指纹资产层抽离
3. runtime 模块边界整理
4. 再进入 control-plane substrate

参考：[architecture-priority-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/architecture-priority-map.md)

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

### 结论四：`/api/eval/*` 的字段分层已经冻结

这意味着：

- 后续再看到 eval 变化时，不用先翻源码猜字段意义
- 可以直接按矩阵判断它属于：
  - auth model 变化
  - transport/base URL 变化
  - session/runtime 噪音
  - 真实新增 schema

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

按优先级看，transport/telemetry 这条主线已经没有必须阻塞 `v1` 的剩余主任务。

当前更适合转为：

- 保持 Docker 和本机 runtime 的配置模型一致
- 把日常复抓、diff、更新文档做成更自动化的维护流

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

> `transport 事实和 Docker 部署都已收口，接下来转入维护自动化和下一阶段架构准备` 的阶段

换句话说：

- 不是从 0 到 1
- 是从 `0.95` 到 `1.0`

这个阶段最重要的不是继续铺功能，而是：

1. 把剩余 side channel 逐条归属
2. 把默认生产模式定死
3. 把研究流程标准化
4. 然后及时收尾
