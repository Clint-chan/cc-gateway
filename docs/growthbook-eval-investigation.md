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

### 4. 默认 cwd 没有可用 trust，但 trusted capture workspace 已单独建立

当前本机状态已经拆成两层：

- home project key：
  `C:/Users/94503`
- home trust：
  `false`
- trusted capture project key：
  `C:/Users/94503/cc-alignment-capture/trusted-eval`
- trusted capture trust：
  `true`

这意味着：

- 不能继续把 home 目录或主仓库根目录当作 `/api/eval/*` 的默认采样环境
- 如果要验证 trust 对 GrowthBook auth 的影响，必须切到独立 trusted capture workspace
- 同一台机器上“默认 cwd 无 trust”和“专用 trusted workspace 有 trust”可以并存，不应该再混为一个结论

## 已做实验

### 1. 默认 cwd 下的 `claude -p "hello"`

结果：

- 能稳定看到：
  - `/v1/messages`
  - `/api/event_logging/v2/batch`
- `/api/eval/*` 在这条采样里曾经缺失过

解释：

- 这是当前最符合真实使用路径的最小 headless 请求
- 但 `print.ts` 里对 GrowthBook 是 fire-and-forget 初始化，所以默认 cwd 下没抓到 `/api/eval/*` 只能说明采样条件不足，不能说明路径不存在

### 2. 默认 cwd 下的 `claude remote-control`

结果：

- 命令返回 `Remote Control is not yet enabled for your account.`
- 当前 direct MITM 抓包里没有出现任何 `/api/eval/*` 流量

解释：

- 这条命令确实会走 `checkGate_CACHED_OR_BLOCKING('tengu_ccr_bridge')`
- 但当前 cwd 没有建立 trust，GrowthBook 很可能在 auth 之前就被短路
- 所以“blocking gate 命令”不等于“必然能抓到 remote eval”

### 3. trusted workspace 下的 `claude -p "hello"`

结果：

- 在同样走 MITM 的前提下，trusted workspace 的最小 headless 请求已经明确抓到：
  - `POST /api/eval/sdk-*`
  - `GET /v1/mcp_servers`
  - `GET /api/claude_cli/bootstrap`
  - `GET /api/claude_code_grove`
  - `GET /api/oauth/account/settings`
  - `GET /mcp-registry/v0/servers`
  - `POST /v1/messages?beta=true`

解释：

- 这证明 `/api/eval/*` 在当前版本并没有消失
- 也证明“headless 一定抓不到 eval”这个判断已经失效
- 同样也证明 MITM 和 env proxy 在 trusted workspace 的 headless 场景下是正常生效的

### 4. trusted workspace 下的 `claude remote-control`

结果：

- 命令仍然返回 `Remote Control is not yet enabled for your account.`
- 当前这条 probe 的 MITM 文件仍然可能为空

解释：

- 现在已经不能再把这件事归因成“系统代理没接上”，因为同一 trusted workspace 下的 `headless-hello` 已经成功抓到了 `/api/eval/*`
- 更合理的解释是：
  - `remote-control` 的 bridge/entitlement 检查在更早阶段就返回了
  - 或者当前账号/命令路径没有进入可观测的 remote eval 发包阶段
- 所以 `remote-control` 现在应被视为“命令特定的 probe”，而不是 `/api/eval/*` 的唯一真相来源

## 当前结论

当前最可靠的判断是：

1. `/api/eval/*` 在当前版本仍然存在，trusted workspace 下的最小 headless 请求已经实抓到
2. headless 本身不是 `/api/eval/*` 的排除条件，真正关键的是：
   - 当前 cwd 的 trust 状态
   - 采样环境是否隔离出独立 project key
3. `remote-control` 当前抓不到流量，已经不能再解释成“代理没带上”；它更像是 bridge/entitlement 特定路径的问题
4. 当前最需要先区分的不是“gateway 有没有改写”，而是：
   - 哪个 transport surface 真正会发
   - 哪个 probe 只是更早被命令逻辑短路了

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
4. 继续优先使用 [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md) 作为 `/api/eval/*` 标准入口
5. 继续把所有结论追加到 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
6. 下一轮开始专项比较：
   - trusted direct `headless-hello`
   - trusted via-gateway `headless-hello`
   看 `/api/eval/*` 和控制面 side channel 哪些还能经系统代理统一出口

## 关联文档

- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [telemetry-automation-plan.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/telemetry-automation-plan.md)
