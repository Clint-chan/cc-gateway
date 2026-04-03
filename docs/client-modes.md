# 客户端模式

## 目的

这份文档把 gateway 客户端接入明确拆成两种模式：

1. `quiet mode`
2. `alignment mode`

如果不先区分这两种模式，后面做抓包、遥测对齐、自动 diff 时会反复踩同一个坑：

- 生产上为了压低旁路流量而主动关闭的通道
- 会被误判成 gateway 没改写、CLI 没发、或者 MITM 没抓到

## 模式一：quiet mode

### 适用场景

- 给测试者直接使用 gateway
- 日常生产使用
- 希望尽量减少 first-party 旁路流量

### 关键配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "ANTHROPIC_AUTH_TOKEN": "your-gateway-client-token",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  },
  "hasCompletedOnboarding": true
}
```

参考：

- [.claude.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.json.example)

### 结果

- 主推理流量走 gateway
- GrowthBook 不再发送
- 1P event logging 不再发送
- bootstrap、metrics opt-out、grove 等非必要控制面请求也会被压掉或收缩

### 结论

`quiet mode` 是当前最适合对外分发的模式。

它的目标不是“研究最新遥测面”，而是“减少 side channel，让实际使用更干净”。

## 模式二：alignment mode

### 适用场景

- 做 MITM 抓包
- 做 direct CLI 和 gateway 的差异对比
- 追踪最新遥测字段和 first-party 控制面变化

### 关键配置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-gateway-host:8443",
    "ANTHROPIC_AUTH_TOKEN": "your-gateway-client-token"
  },
  "hasCompletedOnboarding": true
}
```

参考：

- [.claude.alignment.json.example](/C:/Users/94503/Documents/GitHub/cc-gateway/.claude.alignment.json.example)

### 结果

- 主推理流量仍会走 gateway
- GrowthBook 和 1P event logging 有资格重新出现
- 但它们不一定跟随 `ANTHROPIC_BASE_URL`
- 其中一部分会继续直指 `api.anthropic.com`

### 额外要求

`alignment mode` 必须配合系统代理或 MITM 才有意义。否则：

- 你只能看到走 gateway 的主链请求
- 看不到直连 `api.anthropic.com` 的 side channel
- 会把“没有抓到”误判成“没有发送”

## 源码依据

### quiet mode 会关闭 telemetry

- [privacyLevel.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/privacyLevel.ts)
- [analytics/config.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/config.ts)
- [growthbook.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/growthbook.ts)
- [firstPartyEventLogger.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/analytics/firstPartyEventLogger.ts)

### custom base URL 还会裁掉一部分 first-party 控制面

- [providers.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/utils/model/providers.ts)
- [settingsSync/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/settingsSync/index.ts)
- [remoteManagedSettings/syncCache.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/remoteManagedSettings/syncCache.ts)
- [policyLimits/index.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/reference/claudecode_source/src/services/policyLimits/index.ts)

## 实际操作建议

### 对外给测试者

默认发 `quiet mode`。

### 对内做研究

使用 `alignment mode`，并且：

1. 让直连和 gateway 都走可控代理
2. 用 [capture-direct.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-direct.ps1) 和 [capture-gateway.ps1](/C:/Users/94503/Documents/GitHub/cc-gateway/scripts/capture-gateway.ps1) 采集
3. 采集结束后先停 `mitmdump`，再用 `extract_signals.py` / `diff_signals.py` 分析

## 维护规则

后续只要发现某个环境变量、某类登录方式、某个 entrypoint 会改变遥测面，就要先判断它属于：

- `quiet mode` 设计结果
- `alignment mode` 研究结果
- 真正的 gateway 改写缺口

不要把这三类问题混在一起。
