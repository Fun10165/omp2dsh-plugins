# AGENTS.md — omp2dsh-plugins 开发规矩

本文件是仓库的**宪法**：任何改动（代码、语料、文档、新包）都必须符合这里的规则。
读它之前，先读 [README.md](README.md) 了解仓库全貌与 [DSH 官方 AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md) 了解 DSH 自身的工程约定。

## 0. 一句话立场

> 我们移植 omp 的能力到 DSH，但**不移植 omp 的体积**。
> 每个插件只做一件事，做小、做薄、做可替换；宁可多一个包，不许多一层职责。

## 1. 与 DSH 设计哲学一致（强制）

1. **一切皆插件**：能力 = 组合里的一行（cordis.yml / cordis.patch.yml）。不写"独立程序"式代码。
2. **双平面**：HOST 组合持有注册表与跨会话共享能力（本仓库的 uri-registry 属于此面）；AGENT PRESET 持有单会话贡献（工具、人设、提示词段）。新包先问自己：它贡献到哪个面？
3. **服务契约通信**：插件之间**只**通过 `ctx.provide` / `ctx.get`（或 `inject`）声明的服务往来，**禁止**跨包直接 import 对方的实现细节（类型 import 允许）。服务是边界，实现是隐私。
4. **生命周期可逆**：一切副作用（工具注册、服务提供、事件监听、handler 注册）必须返回 disposer 或挂在 `ctx.effect()` 上；插件卸载 = 零残留。
5. **官方 API 优先**：用 `@deepseek-ai/dsh-*` 与 `cordis` 的既有能力（`defineTool`、`ctx.tools.register`、`ctx.on`），不自造轮子；API 以 DSH 检出的类型声明为唯一权威，不猜。

## 2. KISS（强制）

1. **单插件单职责**：一个插件回答一个问题。"内置文档"= 语料 + handler；"协议路由"= 注册表 + 工具。谁要把两件事塞进一个包，先解释为什么解耦会失败。
2. **体积红线**：
   - 单插件源码 < 400 行；超过 = 拆文件（仍单职责）或拆包（职责变了）。
   - 依赖红线：运行依赖 ≤ 2 个非 DSH 包；能用 node 内建就不用依赖。
   - 语料/配置等数据**不进代码**：放 `corpus/`、`assets/` 等数据目录，随包分发、独立更新。
3. **不做的事清单**（反模式，看到就打回）：
   - ❌ 一个插件同时做 路由 + 内容 + 搜索 + 翻译 + UI + 发布（生态里已有的大而全反例，禁止效仿）。
   - ❌ 为"可能有用"预埋抽象/配置项（YAGNI）。
   - ❌ 把文档/语料硬编码进 `.ts` 源码（大字符串即技术债）。
   - ❌ 在 `apply()` 外产生进程级副作用。

## 3. 解耦（强制）

1. **三层分离**（本仓库的样板架构）：
   - 路由层（uri-registry）：scheme → handler 注册表 + 通用安全 + 统一工具。
   - 内容层（dsh-docs）：具体协议语义 + 语料访问。
   - 数据层（corpus/）：纯数据，与代码零耦合。
2. **可替换性**：任何一层可以被等价实现替换而不影响其他层（换个语料、换个注册表实现、加个协议，都不动彼此）。
3. **协议即插即用**：新协议 = 新插件注册 handler，不得修改 uri-registry。

## 4. 包结构规范（新建包照抄）

```
packages/<name>/
  src/index.ts        # 插件主体：export const name / inject / apply
  package.json        # name: @omp2dsh/<name>; dsh.bundle.patch 声明
  cordis.patch.yml    # - insert: [{ id: <name>, name: '@omp2dsh/<name>' }]
  tsconfig.json       # extends ../../tsconfig.base.json
  README.md           # 职责边界 + 服务契约 + 与 omp 的对应 + 安装
```

- `name`（插件名）必须与 `cordis.patch.yml` 的 row id 一致。
- 依赖关系只允许 `workspace:*` 指向本仓库其他包；peerDependencies 声明 cordis / dsh 运行时。
- 每个包独立 `build` / `typecheck` / `test`（node:test，不引测试框架）。

## 5. 质量门槛（合并前必须全绿）

1. `pnpm install && pnpm build && pnpm typecheck && pnpm test` 零报错。
2. **测试守契约**：每个测试断言一个可观察的外部契约（工具返回形状、拦截行为、handler 注册/注销、服务可见性）。禁止"测了等于没测"的断言。
3. **文档同步**：改了协议/服务签名，README 与 AGENTS.md 相关段落必须同步改。
4. **changelog**：每个包维护 CHANGELOG.md（Unreleased 一节，格式：Added / Changed / Fixed / Removed），随 PR 更新。

## 6. 移植 omp 的翻译表（判断"迁移是否忠实"）

| omp 概念 | DSH 对应 | 本仓库落点 |
|---|---|---|
| InternalUrlRouter | uriRegistry 服务（ctx.provide） | @omp2dsh/uri-registry |
| ProtocolHandler | UriHandler 接口（scheme/resolve/complete/immutable） | 各内容包 |
| OmpProtocolHandler | dsh:// handler | @omp2dsh/dsh-docs |
| docs-index（嵌入/包/磁盘三级） | STATIC_DOCS + corpus/（同步脚本） | @omp2dsh/dsh-docs |
| read 工具解析内部 URL | read_uri 模型工具 | @omp2dsh/uri-registry |
| 穿越校验/did-you-mean | normalizePath / 同名语义 | 路由层 + 内容层 |

迁移时必须**按职责拆分**，禁止把 omp 的单一文件结构照搬成一个巨型插件。

## 7. 工作流

1. 新想法先写进 README（一句话）+ 拆包判断（哪个面、谁依赖谁）。
2. 实现最小可用（一个包一个职责）。
3. 实证：在 DSH 里实际运行验证（动态插件或 profile 安装），记录结果。
4. 提交信息格式：`pkg(<name>): 动词 简述`（如 `pkg(dsh-docs): add corpus sync script`）。

## 8. 反例存档（引以为戒）

- **大而全**：生态中"文档阅读器"类插件把语料、路由、搜索、翻译、UI、发布全塞进一个 bundle（11MB corpus 随包）——违背 DSH 插件思想。本仓库用两包 + 数据目录复刻同一能力，每个包 < 400 行。
