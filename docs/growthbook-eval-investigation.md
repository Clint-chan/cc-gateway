# GrowthBook `/api/eval/*` 调查

## 目的

这份文档专门记录 `/api/eval/*` 这条链为什么在当前抓包里时有时无，以及应该如何继续验证。

它不是“已经对齐完成”的证明，而是当前阶段的研究基线，避免后面又把三种不同现象混在一起：

1. 路径本来还在，但 headless 进程先退出了
2. 路径本来会阻塞触发，但当前命令没有拿到 GrowthBook auth
3. 路径真的已经不再发

## 已确认事实

### 1. headless `-p` 路径只会 fire-and-forget 初始化 GrowthBook

参考源码在 [print.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/cli/print.ts) 里明确写了：

- headless 模式会调用 `void initializeGrowthBook()`
- 这个调用不会被 `await`

这意味着：

- headless 最小请求可以很快完成主推理
- 但 `/api/eval/*` 作为异步初始化流量，不保证一定在进程退出前完成

所以：

> 在短生命周期 `claude -p "hello"` 里没抓到 `/api/eval/*`，不能直接推导为“这条路径已经不存在”。

### 2. GrowthBook 请求是否带 auth，取决于 trust 状态

参考源码在 [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts) 里明确写了：

- 只有在以下任一条件成立时，GrowthBook 才会拿 auth headers：
  - `checkHasTrustDialogAccepted()`
  - `getSessionTrustAccepted()`
  - `getIsNonInteractiveSession()`
- 如果都不成立，就会走：
  - `error: 'trust not established'`
  - 不注入 `apiHostRequestHeaders`

这意味着：

- `-p` 这类 non-interactive 路径天然带 implicit trust
- local-jsx / interactive 命令如果当前 workspace 没建立 trust，就可能根本不会真正发出带 auth 的 GrowthBook 请求

### 3. 当前本机 `~/.claude.json` 已经有一份较大的 GrowthBook 磁盘缓存

当前本机状态已经确认：

- 全局配置文件：
  [C:\\Users\\94503\\.claude.json](/C:/Users/94503/.claude.json)
- `cachedGrowthBookFeatures` 当前已有大量键值
- 其中包含：
  - `tengu_ccr_bridge = false`
  - `tengu_bridge_repl_v2 = true`
  - `tengu_bridge_min_version = { minVersion: 2.1.70 }`

这意味着：

- 一部分 feature gate 即使当前进程没有实时拉到 `/api/eval/*`，也可以先从磁盘缓存读值
- 因此“命令结果正常/异常”本身，不足以证明这次是否真的发生了远程 eval

### 4. 当前仓库 cwd 没有建立可用 trust

通过本机 `~/.claude.json` 检查到的当前状态是：

- 仅有的已记录 project key 是 `C:/Users/94503`
- 其 `hasTrustDialogAccepted = false`

这意味着当前仓库目录下运行 local-jsx 类命令时：

- 不能假定 GrowthBook 一定会带 auth 去拉远程 eval
- 这类命令不适合作为“稳定抓 `/api/eval/*`”的默认探针

## 已做实验

### 1. `claude -p "hello"`

结果：

- 能稳定看到：
  - `/v1/messages`
  - `/api/event_logging/v2/batch`
- 还不能稳定看到：
  - `/api/eval/*`

解释：

- 这是当前最符合真实使用路径的最小 headless 请求
- 但 `print.ts` 里对 GrowthBook 是 fire-and-forget 初始化，所以这条结果是“未证伪”，不是“已消失”

### 2. `claude remote-control`

结果：

- 命令返回 `Remote Control is not yet enabled for your account.`
- 当前 direct MITM 抓包里没有出现任何 `/api/eval/*` 流量

解释：

- 这条命令确实会走 `checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge')`
- 但当前 cwd 没有建立 trust，GrowthBook 很可能在 auth 之前就被短路
- 所以“blocking gate 命令”不等于“必然能抓到 remote eval”

## 当前结论

当前最可靠的判断是：

1. `/api/eval/*` 不能因为一次 headless 最小抓包里缺失，就被认定为已经下线
2. local-jsx blocking gate 命令不是无条件可用的抓包探针，它受 trust gating 影响
3. 当前最需要先区分的不是“gateway 有没有改写”，而是“这次采样到底有没有进入 remote eval 的真实发包条件”

## 推荐的验证顺序

### 第一步：先看本机 GrowthBook 状态

用：

- [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)

先确认：

- 当前 cwd trust 是否成立
- 是否已经有磁盘缓存
- 关键 bridge / telemetry gate 当前缓存值是什么

### 第二步：明确你在测哪一种路径

#### 路径 A：headless 最小请求

- 目标：
  看真实使用时最小出站面
- 优点：
  最贴近测试者场景
- 缺点：
  `/api/eval/*` 可能因为 fire-and-forget + 进程退出而缺失

#### 路径 B：blocking gate 命令

- 目标：
  强制等待某个 GrowthBook gate
- 优点：
  理论上比 `-p` 更容易把 remote eval 拉出来
- 缺点：
  如果当前 cwd 没 trust，仍然可能拿不到 auth headers

#### 路径 C：长生命周期 interactive 会话

- 目标：
  让 GrowthBook 初始化有足够时间完成
- 优点：
  最有机会把 `/api/eval/*` 真正抓出来
- 缺点：
  自动化最麻烦，必须严格记录 trust、代理、等待时长和退出时机

## 下一步建议

下一轮如果继续追 `/api/eval/*`，建议按这个顺序：

1. 先运行 [inspect-growthbook-state.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/inspect-growthbook-state.ps1)
2. 先确认当前 cwd 是否 trusted
3. 如果不 trusted，不要再把 local-jsx 命令当作 `/api/eval/*` 的主探针
4. 优先设计一个“长生命周期且 trusted”的 capture 场景
5. 继续把所有结论追加到 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

## 关联文档

- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [telemetry-automation-plan.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/telemetry-automation-plan.md)
