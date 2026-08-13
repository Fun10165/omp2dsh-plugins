# @omp2dsh/dsh-docs

DSH 内置文档 —— 从 omp 的 `OmpProtocolHandler` + `docs-index` 移植的内容半部。

**只做两件事**：持有语料（`corpus/`，官方 deepseek-harness docs 215 篇）+ 向 uri-registry 注册 `dsh://` handler。不注册任何模型工具、不碰路由与安全。

## 协议

| URL | 行为 |
|---|---|
| `dsh://` | 根列表（1 篇静态内置 + 215 篇官方） |
| `dsh://docs` | 根别名 |
| `dsh://<file>.md` | 读指定文档（`docs/` 前缀可省略） |
| `dsh://docs/subsystems/tools.md` | 子目录文档 |
| 穿越路径 / 拼错 | 拦截 / `Did you mean` 建议（与 omp 同款语义） |

## 语料独立更新（KISS 解耦的关键）

`corpus/` 是纯数据，与代码分离：

```sh
pnpm sync-corpus                # 重新同步官方 docs（默认 ../deepseek-harness/docs）
pnpm sync-corpus /path/to/docs  # 或指定任意 docs 目录
```

升级文档 = 换语料 + 升版本号，路由/工具代码零改动。

## 分层职责

| 面 | 属于谁 |
|---|---|
| 语料（corpus/ + index.txt） | 本包 |
| `dsh://` handler（resolve/complete） | 本包 |
| `read_uri` 工具、路由、穿越拦截 | @omp2dsh/uri-registry |

## 安装

依赖 uri-registry 已挂载于同一 profile：

```sh
dsh plugin --profile web add github:<you>/omp2dsh-plugins#dsh-docs
```
