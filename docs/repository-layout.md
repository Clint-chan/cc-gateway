# Repository Layout

## 目的

这份文档定义仓库结构规范，而不是功能规划。

它要解决的问题是：

1. 当前阶段哪些文件应该放哪里
2. 测试、抓包、日志、参考源码之间怎么隔离
3. 后续做 `gateway / admin-api / admin-web` 时如何平滑迁移

这份文档的目标不是“现在就把前后端都搭起来”，而是先把底层结构边界定住，避免研究代码、运行时代码、测试资产和未来平台代码混成一团。

## 结构原则

### 1. 运行时代码与研究资产分离

- `src/` 只放 gateway 运行时代码
- `mitm/` 只放抓包脚本、抓包解析脚本、以及必要的研究样例
- `reference/` 只放只读逆向参考，不掺运行时代码
- `docs/` 只放结论、方法论、运维说明和架构设计

### 2. 测试、脚本、日志分层

- `tests/` 只放自动化测试
- `scripts/` 只放可重复执行的辅助脚本
- 运行日志和临时文件不能继续散落在仓库根目录

### 3. 先稳 data plane，再扩 control plane

当前阶段仓库的主角仍然是：

- gateway data plane
- telemetry / transport research

当前阶段仓库的配角只能是：

- control plane 设计文档
- 未来前后端的结构约束

前端和管理 API 在 transport ownership 没冻结前，不进入实现优先级。

### 4. 每个目录只承担一种责任

如果一个目录既放运行时代码，又放抓包日志，又放实验脚本，后续就无法维护。

所以后面每次加文件，都要先回答：

1. 它属于 runtime、test、research、docs 还是 reference
2. 它是源码、脚本、样例、还是生成产物

## 当前规范

### 仓库根目录

根目录只允许放这些：

- 项目级元文件
  - `package.json`
  - `tsconfig.json`
  - `Dockerfile`
  - `docker-compose.yml`
  - `.gitignore`
- 运行配置样例
  - `.env.example`
  - `config.example.yaml`
  - `.claude.json.example`
  - `.claude.alignment.json.example`
- 结构化资产目录
  - `profiles/`
- 少量必须直放根目录的操作文件
  - `README.md`
  - `LICENSE`

不建议继续新增：

- 零散 `*.out.log`
- 零散 `*.err.log`
- 临时调试输出
- 一次性实验文件

### `src/`

只放 gateway 运行时代码。

当前允许内容：

- 配置加载
- 鉴权
- OAuth 令牌管理
- 请求改写
- upstream 转发
- runtime logger
- scheduler / admission policy 模块

当前不应该放：

- MITM 解析脚本
- 测试夹具
- 参考源码副本
- 管理后台原型

### `scripts/`

只放可重复执行的工程脚本，不放“随手跑一次”的命令记录。

当前建议按责任继续收拢为：

```text
scripts/
  capture/
  dev/
  ops/
```

现阶段还没强制迁移，但新增脚本应尽量按这个方向命名和分类。

当前已经开始落到这个方向：

- `scripts/ops/run-telemetry-maintenance.ps1`

### `tests/`

只放自动化测试。

当前建议结构：

```text
tests/
  unit/
  integration/
  fixtures/
```

当前单测已经迁到 [rewriter.test.ts](/C:/Users/94503/Documents/GitHub/cc-gateway/tests/unit/rewriter.test.ts)，后续新增测试不要再直接平铺到 `tests/` 根下。

### `mitm/`

这是研究资产目录，不是通用日志目录。

允许内容：

- `capture.py`
- 抓包解析脚本
- 差异对比脚本
- 少量经过筛选的 `.log` / `.flows` 样例

不建议把它当作：

- 通用运行日志目录
- gateway 标准 stdout/stderr 目录
- 长期累积的原始抓包垃圾桶

### `reference/`

只放逆向参考和只读上游资料。

规则：

- 不修改 reference 内代码来驱动当前项目运行
- 只把它当作证据源和对照源
- 结论必须回写到 `docs/`，不能只留在 reference 里

### `docs/`

只放四类文档：

1. 设计文档
2. 运维文档
3. 调查文档
4. 结构规范

每次有新的 transport / telemetry 结论时：

- 调查过程写进专项文档
- 结果摘要写进 [packet-alignment-log.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/packet-alignment-log.md)
- 全局索引写进 [fingerprint-catalog.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/fingerprint-catalog.md) 或 [transport-surface-map.md](/C:/Users/94503/Documents/GitHub/cc-gateway/docs/transport-surface-map.md)

### `profiles/`

这是结构化配置资产目录，不是运行日志目录。

当前方向：

- `profiles/fingerprints/` 存放可复用指纹 profile

规则：

- 账号身份不放进指纹 profile
- OAuth secrets 不放进指纹 profile
- profile 文件应可版本化、可审阅、可热更新

## 运行日志与生成产物

后续应逐步把生成产物从仓库根目录迁走。

推荐目标：

```text
runtime/
  logs/
  tmp/

artifacts/
  captures/
  reports/
```

约束：

- `runtime/`：给本地运行时日志、pid、临时文件
- `artifacts/`：给一次性分析产物、报告导出、辅助对比结果
- `mitm/`：只保留研究工具和必要样例，不承载所有生成物

现阶段可以先不迁目录，但新增工具不要继续往根目录吐新的 `*.log`。

当前运行日志推荐直接落到：

- `runtime/logs/gateway.log`
- `runtime/logs/audit.log`

## 近期推荐结构

在正式拆成 monorepo 之前，先把当前仓库往这个形状收：

```text
docs/
mitm/
reference/
scripts/
  capture/
  dev/
  ops/
src/
  auth.ts
  config.ts
  index.ts
  logger.ts
  oauth.ts
  proxy.ts
  rewriter.ts
  scripts/
tests/
  unit/
  integration/
  fixtures/
```

说明：

- 这一步不要求立刻重命名所有文件
- 但所有新增文件都应该按这个方向放

## 中期目标结构

当 transport ownership、telemetry 策略和 gateway 主链稳定后，再进入真正的平台拆分：

```text
apps/
  gateway/
  admin-api/
  admin-web/

packages/
  policy-engine/
  rewrite-engine/
  oauth-manager/
  shared-types/
  shared-config/
  shared-logger/

tests/
  unit/
  integration/
  e2e/
  fixtures/

infra/
  docker/
  compose/
  nginx/
  monitoring/
```

这里的前提是：

- 不是现在就开始做前端
- 而是先确保未来前后端拆分时，当前仓库不会因为结构混乱而重做一遍

## 决策规则

后面每次加文件，先按这套规则判断：

### 新增运行逻辑

- 放 `src/`

### 新增可重复执行脚本

- 放 `scripts/`

### 新增自动化测试

- 放 `tests/`

### 新增抓包、遥测解析、diff 工具

- 放 `mitm/` 或 `scripts/capture`

### 新增逆向参考

- 放 `reference/`

### 新增结论文档

- 放 `docs/`

### 新增运行日志或一次性输出

- 不进 git
- 优先放 `runtime/` 或 `artifacts/`

## 当前结论

当前最重要的不是“把目录做得像大公司 monorepo”，而是：

1. 先把 runtime / research / tests / docs / reference 的边界守住
2. 先停止根目录继续堆日志和临时文件
3. 先让后续前后端拆分有明确迁移目标

只要这三点守住，后面再进 `apps/gateway`、`admin-api`、`admin-web` 时，成本就会低很多。
