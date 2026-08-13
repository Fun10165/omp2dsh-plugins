# 插件开发经验总结：从 omp 迁移到 DeepSeek Harness

> 本文档记录本仓库插件（bang / uri-registry / dsh-docs）从零到成型的真实开发历程：
> 踩过的坑、验证过的机制、以及"遵守 DSH 哲学"的具体落点。
> 规矩见 [AGENTS.md](../AGENTS.md)，本文件是"为什么"。

## 1. 最核心的一条经验：先读官方文档和源码，再动手

DSH 是**插件化 harness**，一切能力都是插件行，但插件的**扩展点**是精确的、文档化的。
本仓库开发初期最大的教训：不查官方文档直接猜 API，连续三次返工（dock 渲染、注入机制、命令管线），
用户明确批评"你一直不查 dsh 的官方文档，就在这里瞎猜"。

正确顺序：

1. **读** `deepseek-harness/docs/`（架构、subsystems、cookbook）+ 对应 `packages/*/src` 源码。
2. **用 Inspect** 查运行时契约（Service / Event / Slot / Builtin / Tool 目录）。
3. 只在确认契约后写代码；运行时行为以"真实服务调用"验证，不以猜测为准。

官方文档树是分级权威：`architecture.md`（地图）→ `subsystems/*.md`（每子系统类型与 Cordis API）→
包 README（组合与限制）→ 源码（最终真相）。

## 2. 动态插件（创造模式）与正式包的差异（bang 开发中实测）

| 能力 | 动态插件沙箱 | 正式 bundle 包 |
|---|---|---|
| 工具注册 | `harness.defineTool(...)` 打标记后 `harness.registerTool`；裸对象被拒 | `ctx.tools.register(defineTool(...))`；`tools.register` 只校验 output 形状，plain 对象也可 |
| Client↔Host RPC | `harness.handle` + `host.call`（package-private） | @Remote / webServer JSON API / `dsh.client` 机制 |
| 全局 | 无 `import`/`require`/`process`/`Buffer`/`AbortController`；有 `btoa/atob/TextEncoder/TextDecoder` | 完整 Node/浏览器环境 |
| 服务访问 | `ctx.get(name)` + undefined 检查 | 同；`inject` 声明硬依赖可让 Cordis 等待 |

动态沙箱缺 `AbortController` 的解法：`commands.execute` 只读 `signal.aborted` 并挂 abort 监听，
传一个永不过期的 signal 形状 `{ aborted: false, addEventListener(){}, removeEventListener(){} }` 即可。

## 3. DSH 官方机制语义对照（bang 的六个版本迭代总结）

| 机制 | 语义 | 何时用 |
|---|---|---|
| `commands.register` + `commands.execute` | 命令卡片渲染（`command/run`+`command/done` 持久于会话日志）、结果不进模型历史 | **用户交互命令**（/b /bb 的载体） |
| `session.append('user/message', …, { surfaceOp:'append' })` | 注入消息进会话流：WebUI 显示 + 持久 + 后续回合模型可见，**不唤醒驱动** | 插件产出需要"进上下文但不触发回合"（/b 的注入） |
| `agent.steer(message)` | 提交到最近 step，idle 时**启动回合** | 需要模型立即处理（plan-mode 的 /plan message） |
| `agent.send(msg, target, wakeup:false)` | 只排队 inbox，**不显示在会话流** | 几乎不用——用户看不到会产生"注入撒谎"的错觉 |
| 伪造 ToolResultMessage | **不可行**：必须与真实 tool call 配对，DeepSeek API 拒绝 | 绝不——工具输出不可伪造 |

关键领悟：**"WebUI 看到 == 进上下文"是 DSH 的哲学**，但"进上下文"不等于"触发模型回合"。
注入消息必须**带来源标记**（"由插件自动注入，非用户直接输入"），否则模型会把命令输出误判为用户指令。

## 4. 渲染：用官方插槽，不自己造 UI

- 命令卡片：`conversation.chat.commandview`（keyed by 命令名，fallback 是 `GenericCommandCard`）。
  默认卡片折叠，`/b` 的执行输出用户通常想直接看 → 注册自定义卡片默认展开（v7）。
- 输入框工具行：`conversation.input.left`（owner props 直接给 `InputState.draft`）。
- 输入区 dock：`conversation.input.dock`（在 composer 上方，横贯整行——不适合承载执行结果，已弃用）。
- 触发管线：`ctx.inputTriggers.registerSource` **只认 `/` 和 `@`**（`TriggerChar` 类型锁死），
  `!` 前缀无法注册为触发源——这是 v1 方案废弃的根本原因。

## 5. 沙箱事实：workspace-write 拦文件写，不拦命令执行

`zed .` / `code .` 这类 GUI 启动命令**不会被文件沙箱拦截**（源码 `dsh-bash-local` 不 confine，
`dsh-bash-sandbox` 才 confine 且 full-access 直通；沙箱约束作用于 fs 服务与文件层）。
`!` 执行走 `shell` 服务 + `sandboxPolicy.resolve({ session })`（bash 工具同路径），行为可预期。
但注意：命令执行不经工具级审批管线——用户主动点击/输入的交互命令，审批由部署方决定是否外包一层。

## 6. 测试守修复（本仓库的测试哲学）

"初版就能通过"的测试是无用测试（守护不了任何真实 bug）。有效测试必须：

- 在某个历史版本上**失败**、在修复版上**通过**（回归测试）。
- 锚定真实修复点：bang 的 v3（官方管线映射）、v4（无 emoji/无 steer）、v5（/b 注入 vs /bb 排除）、
  v6（来源标记）；dsh-docs 的剥壳时序修复。
- 纯函数优先（工厂/解析器/渲染文本），不依赖 cordis 运行时。

## 7. 与 omp 的语义映射（bang 为例）

| omp | DSH 版 | 差异说明 |
|---|---|---|
| `!cmd`（结果进上下文） | `/b cmd`：命令卡片 + `session.append` 注入（带来源标记，不唤醒） | omp 在 idle 时会阻塞等回合；DSH 版不触发回合，更静默 |
| `!!cmd`（排除上下文） | `/bb cmd`：仅命令卡片 + excluded 标注 | 语义一致；卡片显式标注更透明 |
| `bashExecution` 专用消息角色 | user/message + 文本来源标记 | DSH 无自定义消息角色；用合法 user 消息 + 显式文本避免 API 问题 |
| TUI 边框变色提示 bash 模式 | 无（斜杠命令天然提示） | 更简单 |

## 8. 工具注入的"缓存命中率"机制（动态/后注入工具的可见性）

实测确认：**后注册的工具（动态插件或运行中安装的 bundle）对模型可用，但当前会话的
function-calling schema 是早期快照**——本会话注册的 `read_uri` 在 `Tool.listTools`
（注册表视图）可见、子代理（新回合）可调用，但主 agent 当前回合的工具集不含它；
**新建会话（纯净环境）即可见可用**。这是 DSH 为保持模型请求工具集稳定（缓存命中率）
做的设计：工具集以回合/会话为单位组装，注册后从下一个新会话生效。

对插件开发的启示：
- 验证"模型能否调用某工具"要在**新会话**做，旧会话的快照会误导判断。
- `Tool.listTools`（inspect）显示注册表视图，不等于当前回合 schema——两者管道不同
  （注册表 vs `systemPrompt.assemble` 的 `wireSchemas(scope)`）。
- **子代理是新回合工具集的可靠试用载体**：召唤子代理（后台）即可拿到包含全部后注册
  工具的干净工具集——验证新工具（如 read_uri）的首选途径，且不占用主会话回合。
  子代理在后台运行时，主 agent 可并行做其他独立工作（文档、代码、更多子代理），
  完成时自动收到通知——无需串行等待。

## 9. Client 插件契约：`__ModuleLoader__.load`（bang 实测踩坑，重要）

**坑**：client half 用裸 ESM 导出 + 手写 slots 参数 → fsck 报
`loaded without registering "<id>" via __ModuleLoader__.load`，client 静默不挂载。

**官方契约**（`deepseek-harness/packages/client/AGENTS.md` + `tsdown.client.ts` preset）：

1. **注册**：browser bundle 必须以 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`
   包裹（loader 模块表持有 react 等平台模块；`require` 从表中解析 external）。
2. **入口导出纪律**：client 入口**只导出 `inject` 和 `apply`**——没有其他导出。
3. **apply(ctx: ClientContext)**：通过 `ctx.slots.inject('…', () => ctx.slots.register({name, key}, Component))`
   挂载 UI；**等待声明**（inject）再 register，直接 register 会竞态失败。
4. **构建**：tsdown browser bundle（`format: cjs`、`platform: browser`、react/平台模块 external、
   banner/footer 包裹 `__ModuleLoader__.load`）；与 tsc node half 共用 lib/（`clean: false`）。
5. **样式**：用官方 design tokens（`--dsw-alias-*`、`--ds-font-family-code` 等），**不要**自造 CSS 变量
   （明暗主题跟随失效）。
6. **类型**：`CommandRowProps`/`CommandNode` 等从 `@deepseek-ai/dsh-client-runtime/client`、
   `@deepseek-ai/dsh-client-ui-conversation/client` 导入（type-only，SlotMap 声明合并）。
7. **包声明**：`dsh.client: { platform: 'web', inject: [...] }`；devDeps 加 tsdown/react/@types/react/
   dsh-client-runtime/dsh-client-ui-conversation（版本对齐宿主）。

**omdsh-dev 档案补充**（`omdsh-dev/dsh-plugin-dev`，本仓库开发前应读）：
- **cordis 双副本**：插件编译期 `cordis` 必须解析到 DSH 的 vendor 副本（不是 .pnpm），否则
  `ctx.tools` 类型增强合并失败（`Property 'tools' does not exist on type 'Context'`）。
- **tsconfig 三件套**：`allowImportingTsExtensions` / `rewriteRelativeImportExtensions` /
  `lib: ["ES2024"]`。
- **运行时依赖**：peer 依赖经 profile fallback 解析（`healProfilesModuleFallback`），与编译期
  解析一致；`link:` 依赖改源码后**重构建 + 重启**生效，无需重新 add。
- **形态选择**：默认 bundle；registry 面板生命周期才用 registry 原生形态；纯流程用 skill。

## 10. 一句话总结

> **DSH 插件开发的正确姿势：先读文档和源码确认官方机制 → 用官方插槽/服务/事件组合能力 →
> 绝不伪造运行时数据（tool result、消息角色）→ 每次真实 bug 修复补一条回归测试 →
> 保持一个插件一个问题，KISS 和解耦。**
