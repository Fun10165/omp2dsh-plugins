# @omp2dsh/bang

`!` 前缀快速运行命令 —— 移植自 omp 的 bang/bash 输入模式，但**按 DSH 哲学重新设计**。

## 用法

在会话输入框：

| 输入 | 行为 |
|---|---|
| `!zed .` | 执行命令；**结果写入会话流**（WebUI 可见 → 进上下文，后续回合模型可见），dock 标注 "📥 已注入上下文" |
| `!!ls -la` | 执行命令；**结果只在 dock 面板显示**，标注 "🔒 已排除上下文：模型不可见" |
| 其他输入 | 按钮置灰，不影响正常对话 |

交互入口：输入框左侧 **⚡ ! / 🔒 !** 按钮（点按钮执行当前以 `!`/`!!` 开头的草稿）。

## DSH 哲学的落点（为什么这样设计）

- **"WebUI 看到的东西都会进上下文"**：`!` 的结果必须进上下文，所以它作为一条插件来源的用户消息写入会话流（`agent.send(msg, 'next-turn', wakeup: false)`——不唤醒驱动，当前回合不被打断，后续回合模型自然可见）。
- **`!!` 需要谨慎标注**：结果只显示在 dock（输入区 UI，非会话流），物理上不进上下文；dock 上明确标注"模型不可见"，杜绝"用户以为模型看到了"的误导。这比 omp 的静默排除更进一步——omp 是 TUI 里一条 bash 卡片，DSH 哲学要求显式。
- **沙箱透明**：执行走 `shell` 服务 + 会话 `sandboxPolicy`（与 bash 工具同路径）。`zed .` / `code .` 这类 GUI 启动命令**不会被文件沙箱拦截**（沙箱约束文件写，不约束命令执行；已实测确认）。

## 分层

| 面 | 属于谁 |
|---|---|
| 执行（shell + sandboxPolicy + cwd） | Host `createBangRunner`（纯工厂，可测） |
| 结果注入会话流（`!`） | Host `note`（agent.send，不唤醒） |
| 按钮 / dock / 前缀解析 / 🔒 标注 | Client `src/client.ts`（`parseBangDraft` / `executeBang`，传输无关） |
| RPC 传输 | 动态原型：`harness.handle`（'bang/run' / 'bang/note'）；bundle 版：@Remote 或 HTTP（同方法名） |

## 测试

```sh
pnpm test        # 纯工厂 + 解析器 + 执行编排（含"!! 永不 note"契约）
```

## 与 omp 的对应

| omp | 本包 |
|---|---|
| `!cmd`（进上下文） | `!cmd` → 结果注入会话流 |
| `!!cmd`（排除上下文） | `!!cmd` → dock 显示 + 🔒 显式标注 |
| `$ code` python 模式 | 未移植（YAGNI，需要再加） |
| `#` prompt-action | 未移植（DSH 无此机制，避免造轮子） |
| isBashMode 边框变色 | 未做（按钮状态即模式提示，KISS） |

## 安全说明

- 执行与 bash 工具同路径（shell + sandboxPolicy），但**不经过工具级 guard/审批管线**（它是用户主动点击的交互命令，类似终端面板）。部署时如需审批，可在 shell 执行前包一层 approval（留给部署方决定）。
- 命令以会话 cwd 为工作目录，超时 60s，输出有界（shell 服务自带 maxOutputBytes）。
