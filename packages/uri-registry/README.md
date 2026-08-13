# @omp2dsh/uri-registry

URI 协议注册器 —— 从 omp（oh-my-pi）的 `InternalUrlRouter` 移植到 DSH 的路由半部。

**只做一件事**：让任何插件注册 `scheme://` 处理器，并通过唯一工具 `read_uri` 统一访问。不碰内容、不碰文件、不认识任何具体协议。

## 职责

| 面 | 属于谁 |
|---|---|
| 路由（scheme → handler） | 本包 |
| 通用安全（路径穿越拦截、返回形状校验） | 本包 |
| 统一模型工具 `read_uri` | 本包 |
| 具体协议内容（如 `dsh://` 文档） | 其他插件（见 @omp2dsh/dsh-docs） |

## 服务契约（ctx.get('uriRegistry')）

```ts
interface UriRegistry {
  register(handler: UriHandler): () => void          // 注册，返回注销器
  unregister(scheme: string): boolean
  listSchemes(): { scheme; immutable; hasComplete }[]
  resolve(input: string, context?): Promise<UriResource & { immutable: boolean }>
  complete(scheme, query?, context?): Promise<{ value }[]>
  normalizePath(rest: string): string                // 穿越防护，handler 复用
}
```

任何插件（bundle、skill、动态插件）都可以：

```ts
const registry = ctx.get('uriRegistry')   // 或 inject: ['uriRegistry']
ctx.effect(() => registry.register({
  scheme: 'myproto',
  immutable: true,
  async resolve(url, context) { return { url: url.href, content: '...', contentType: 'text/markdown' } },
}))
```

注册后模型即可通过 `read_uri` 读 `myproto://...`。

## 与 omp 的对应

| omp | 本包 |
|---|---|
| `InternalUrlRouter`（16 协议注册表） | `uriRegistry` 服务 + handlers Map |
| read 工具解析内部 URL | `read_uri` 模型工具 |
| handler 级 `immutable` | handler.immutable → 资源 immutable 标记 |

## 安装（profile bundle）

```sh
dsh plugin --profile web add github:<you>/omp2dsh-plugins#uri-registry
```

或把 `@omp2dsh/uri-registry` 加入 profile 的 `dsh.profile.bundles`（`cordis.patch.yml` 已就位）。
