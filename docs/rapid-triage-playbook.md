# 快速定位手册

## 目的

这份文档回答一个非常实际的问题：

> 当 Claude Code 升级、side channel 变化、或者 gateway 突然出现新差异时，怎么在 30 分钟内判断“到底该改哪一层”。

这里的目标不是一次性把问题修完，而是先把问题归类正确。

如果归类错了，后面经常会出现三种低效情况：

- 明明是客户端接入模型的问题，却去改 gateway rewrite
- 明明是 direct-host side channel，却去查 `ANTHROPIC_BASE_URL`
- 明明是 `quiet mode` 主动压掉的请求，却误判成“上游改了”

## 核心原则

快速定位时，不要先问“怎么改”。

要先问这 4 个问题：

1. 这个现象只在 `direct` 出现，还是 `via-gateway` 也出现
2. 这个现象只在 `managed-oauth` 出现，还是 `external-auth-token` 也出现
3. 这个现象只在 `alignment mode` 出现，还是 `quiet mode` 也出现
4. 这是“请求有没有发出来”的问题，还是“发出来但字段不对齐”的问题

只有先把这 4 个问题回答完，才知道该改哪一层。

## 30 分钟流程

### 第 1 步：固定实验矩阵

先不要直接跑生产默认配置。

先固定一套最小研究矩阵：

- workspace:
  `trusted capture workspace`
- traffic mode:
  `alignment mode`
- auth mode:
  `managed-oauth`
- probe:
  `headless-hello`

原因：

- `quiet mode` 会主动裁掉 telemetry
- `external-auth-token` 会主动改写 CLI 的 subscriber/OAuth 叙事
- 如果这两个变量不先固定，抓包结果没有对比价值

参考：

- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)
- [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)

### 第 2 步：跑 direct 基线

先看官方 CLI 现在真实发了什么。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-direct.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\probe-growthbook-eval-direct.ps1 -Probe headless-hello
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-direct-capture.ps1
python mitm\extract_signals.py mitm\direct.flows 20
```

如果只想看某一条链：

```powershell
python mitm\extract_signals.py mitm\direct.flows 20 /api/eval/
python mitm\extract_signals.py mitm\direct.flows 20 /api/event_logging/
python mitm\extract_signals.py mitm\direct.flows 20 /v1/messages
```

如果怀疑 `/api/eval/*` 是“字段变了”而不是“有没有发出来”，直接补跑：

```powershell
python mitm/summarize_eval_field_matrix.py --label current-baseline --format json
```

### 第 3 步：跑 via-gateway 对照

然后用同样的 workspace、同样的 probe、同样的 auth mode 跑 gateway。

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\capture-dual-via-gateway.ps1 -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\probe-trusted-via-gateway.ps1 -EnableDirectMitm -AuthMode managed-oauth
powershell -ExecutionPolicy Bypass -File .\scripts\finalize-dual-via-gateway.ps1 -StopGateway
```

这里一定要注意：

- `NO_PROXY=localhost,127.0.0.1` 必须存在
- 否则主链会被误送进 direct MITM，结论会失真

### 第 4 步：先分类，不要先改代码

按下面这张表先判断问题归属。

## 判定矩阵

### 情况 A：direct 有，gateway upstream 没有

优先怀疑：

- `direct-host side channel`
- `gated surface`
- 抓包矩阵没固定好

先看：

- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)
- [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)

不要第一反应就去改：

- [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)

### 情况 B：managed-oauth 有，external-auth-token 没有

优先怀疑：

- `auth mode` 改变了客户端行为面

这类问题通常不是 gateway rewrite 缺口，而是客户端接入方式本身改坏了 telemetry 叙事。

先看：

- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)
- [reference auth.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/auth.ts)

如果差异正好出现在 `claude remote-control`，再补看：

- [remote-control-gating.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/remote-control-gating.md)

### 情况 C：alignment 有，quiet 没有

优先怀疑：

- `traffic mode` 设计结果

这通常不是 bug，而是 `quiet mode` 主动压掉了非必要流量。

先看：

- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)

### 情况 D：两边都有，但 header/body 不同

优先怀疑：

- `rewrite` 层问题
- `persona` 统一策略没覆盖

先看：

- [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- [proxy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/proxy.ts)
- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)

### 情况 E：direct 和 gateway 都 403

优先怀疑：

- 官方登录态或 token 本身失效
- 当前 CLI 认证形态变了
- 系统代理或 MITM 链路异常

先看：

- [auth-proxy-debugging.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/auth-proxy-debugging.md)
- [operations.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/operations.md)

## 快速映射：改哪一层

### 1. 传输归属层

如果问题是“这条请求到底走哪”，先改文档，不先改代码。

更新：

- [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)

### 2. 客户端模式层

如果问题是“换个环境变量就行为大变”，先更新模式文档和样例。

更新：

- [client-modes.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/client-modes.md)
- [`.claude.json.example`](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)
- [`.claude.alignment.json.example`](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)

### 3. 指纹目录层

如果问题是“某个字段、新 beta、新 telemetry 面变了”，先把证据挂进目录。

更新：

- [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md)

### 4. gateway rewrite 层

如果问题是“gateway upstream 已经过了，但 body/header 还不对”，才改代码。

优先看：

- [rewriter.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/rewriter.ts)
- [proxy.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/src/proxy.ts)

### 5. 记录层

每次确认一个新结论，必须回写：

- [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)

如果结论改变了工作流，也要同步：

- [trusted-capture-workflow.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/trusted-capture-workflow.md)

### remote-control 错误文本速判

- `requires a claude.ai subscription`
  先看 auth mode，不要查代理
- `requires a full-scope login token`
  先看 `CLAUDE_CODE_OAUTH_TOKEN` / setup-token，不要查 gateway rewrite
- `not yet enabled for your account`
  先看 bridge entitlement gate，不要先怀疑 MITM

## 推荐指令模板

以后你要我快速跟进某次 Claude Code 更新，直接发这种指令最有效：

```text
跑一轮 direct vs via-gateway 对照，使用 managed-oauth，输出：
1. 新增/消失的 endpoint
2. 它属于哪一层：traffic / auth / transport / rewrite
3. 该改哪个文件
4. 记到 packet-alignment-log
```

如果你怀疑是接入模型导致的失真，就发：

```text
对比 managed-oauth 和 external-auth-token 两种接法，看看是不是客户端接入模型自己改坏了 telemetry 面
```

如果你怀疑是官方新加了 side channel，就发：

```text
跑一轮 alignment 模式抓包，找新增的 endpoint 和新增字段，然后更新 fingerprint-catalog 和 transport-surface-map
```

## 收口标准

快速定位完成，不等于问题修完。

这一轮只要做到下面 4 件事，就算定位完成：

1. 知道是哪一种 mode 触发的
2. 知道它是 direct-host、gateway-mainline 还是 gated surface
3. 知道该改文档、脚本还是 runtime
4. 在 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md) 留下证据链

## 一句话总结

快速定位的核心不是“多看日志”，而是：

> 先固定矩阵，再跑 direct 和 via-gateway，对照 `traffic mode`、`auth mode`、transport ownership，最后才决定改哪一层。
