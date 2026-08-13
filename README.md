# omp2dsh-plugins

把 [omp（oh-my-pi）](https://github.com/can1357/oh-my-pi) 的能力**按 DSH 的设计哲学**移植到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的插件 monorepo。

> **规矩先行**：本仓库的插件必须与 DSH 设计哲学一致——小而聚焦、KISS、解耦。**拒绝大而臃肿的设计**（反例：一个插件塞下语料 + 路由 + 搜索 + 翻译 + UI + 发布流程）。详细规则见 [AGENTS.md](AGENTS.md)。

## 包列表

| 包 | 对应 omp 组件 | 职责（一句话） | 状态 |
|---|---|---|---|
| [`@omp2dsh/uri-registry`](packages/uri-registry/) | `InternalUrlRouter` | 协议注册器：任何插件可注册 `scheme://` handler，统一经 `read_uri` 工具访问 | ✅ 已实现并实测 |
| [`@omp2dsh/dsh-docs`](packages/dsh-docs/) | `OmpProtocolHandler` + `docs-index` | DSH 内置文档：注册 `dsh://` handler，语料（官方 docs 215 篇）独立可更新 | ✅ 已实现并实测 |

### 架构（为什么拆两个包）

```
@omp2dsh/uri-registry                  @omp2dsh/dsh-docs
  ├─ ctx.provide('uriRegistry')          ├─ corpus/（官方文档，纯数据，可单独更新）
  │   register / resolve / complete      └─ register({ scheme: 'dsh', resolve, complete })
  ├─ read_uri 模型工具（统一入口）
  └─ 通用安全（穿越拦截、形状校验）
```

- **路由与内容解耦**：注册器不知道任何具体协议；文档插件不知道路由怎么实现。
- **语料与代码解耦**：升级文档 = `pnpm sync-corpus` + 升版本，不动一行插件代码。
- **协议即插即用**：新协议（`issue://`、`omp://` 代理、自定义 scheme）= 一个新插件注册即可。

## 快速开始

```sh
pnpm install        # pnpm workspaces
pnpm build          # tsc 编译全部包 → lib/
pnpm test           # 各包 node:test
pnpm sync-corpus    # 重新同步官方文档语料（需 ../deepseek-harness/docs 或传路径）
```

在 DSH profile 中使用（bundle 方式）：

```sh
dsh plugin --profile web add github:<you>/omp2dsh-plugins
# 并在 profile 的 dsh.profile.bundles 加入 @omp2dsh/uri-registry 与 @omp2dsh/dsh-docs
```

运行后模型可用 `read_uri` 访问：`dsh://`（根列表）、`dsh://docs/architecture.md`（单篇）。

## 设计哲学（一句话版）

1. **一切皆插件**：能力 = cordis.yml 一行；插件间只经服务契约通信。
2. **KISS**：单插件单职责；超过一个文件装不下的事，拆包而不是膨胀。
3. **解耦**：路由/内容/语料/UI 分层；每层可独立演进、独立更新。
4. **可逆**：所有副作用可卸载（disposer / effect）；stop/undefine 即清理。

完整规则、开发流程、验收门槛见 [AGENTS.md](AGENTS.md)。
