# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Lume** 是一个 Typora 风格的所见即所得 Markdown 编辑器，基于 Electron + React + TypeScript 构建。
核心交互行为：光标所在的 block 显示原始 Markdown 源码；光标离开后渲染为格式化 HTML。没有独立的"编辑/预览"切换按钮。

## Commands

```bash
npm run dev          # 开发模式（热重载）
npm run build        # 类型检查 + 构建所有进程
npm run build:win    # 打包 Windows 安装包
npm run lint         # ESLint
npm run typecheck    # TypeScript 检查（node + web 两个配置）
npm run format       # Prettier
```

No test runner is configured yet.

## Electron-vite 三进程架构

| 进程 | 入口 | tsconfig |
|------|------|----------|
| Main（Node.js） | `src/main/index.ts` | `tsconfig.node.json` |
| Preload | `src/preload/index.ts` | `tsconfig.node.json` |
| Renderer（React） | `src/renderer/src/main.tsx` | `tsconfig.web.json` |

**IPC 约定**：Preload 通过 `contextBridge` 将 `window.electron`（来自 `@electron-toolkit/preload`）和 `window.api`（自定义）暴露给 Renderer。文件读写等 Node.js 能力必须在 `src/main/index.ts` 用 `ipcMain.handle` 注册，在 `src/preload/index.ts` 里用 `contextBridge.exposeInMainWorld` 暴露，类型声明写在 `src/preload/index.d.ts`。

## 技术选型

| 层 | 选型 | 说明 |
|----|------|------|
| 编辑器框架 | **ProseMirror** | 提供 Schema / Transaction / NodeView 等精确的文档模型 |
| Markdown 解析/序列化 | **prosemirror-markdown** | 官方桥接库，内置 `defaultMarkdownParser` 和 `defaultMarkdownSerializer` |
| UI 框架 | React 19 | 编辑器以 React 组件包装，UI 部分（工具栏、侧边栏等）用 React |

`prosemirror-markdown` 包含 `unified` / `remark` 生态，安装它即可获得完整的 Markdown ↔ PM Node 转换能力，无需单独安装 remark。

已安装的 ProseMirror 相关依赖：
`prosemirror-state`, `prosemirror-view`, `prosemirror-model`, `prosemirror-markdown`,
`prosemirror-commands`, `prosemirror-keymap`, `prosemirror-history`, `prosemirror-inputrules`, `prosemirror-schema-list`

## 编辑器架构设计

### 数据流

```
.md 文件
   │ (IPC file:open)
   ▼
Markdown 字符串  ──  defaultMarkdownParser.parse()  ──▶  PM Document (Node 树)
                                                              │
                                                    EditorView 渲染
                                                              │
                                               用户编辑 → Transaction → 新 PM Document
                                                              │
                                          defaultMarkdownSerializer.serialize()
                                                              │
                                                     Markdown 字符串
                                                              │ (IPC file:save)
                                                           .md 文件
```

PM Document 是唯一的数据源。Markdown 字符串仅在打开/保存文件时使用。

### 目录结构规划

```
src/renderer/src/
  components/
    Editor/
      index.tsx           # React 包装组件，创建并持有 EditorView
      TyporaNodeView.ts   # Typora 行为的核心 NodeView
      plugins.ts          # PM 插件集合（history, keymap, inputRules…）
      Editor.css          # 编辑器样式（rendered/source 两种状态）
  App.tsx                 # 顶层布局（工具栏 + Editor + 文件树等）
src/main/index.ts         # IPC handlers（file:open / file:save / file:saveAs）
src/preload/index.ts      # contextBridge 暴露 window.api.file.*
src/preload/index.d.ts    # window.api 的 TypeScript 类型声明
```

### NodeView 模式（Typora 行为核心）

每个 block 节点（paragraph, heading, code_block, blockquote 等）注册一个 `TyporaNodeView`：

```
TyporaNodeView
├── dom: <div class="typora-block">
│   ├── renderedDiv: <div class="typora-rendered">  ← 默认显示，展示格式化 HTML
│   └── sourceTextarea: <textarea class="typora-source">  ← 编辑时显示，展示原始 MD
```

状态切换逻辑：
- **click on renderedDiv** → `enterEditMode()`：序列化当前 PM Node → Markdown 字符串，填入 textarea，切换显示
- **textarea blur** → `exitEditMode()`：读取 textarea 内容，`markdownToNodes()` 解析，`view.dispatch(tr.replaceWith(...))` 更新 PM 文档，切换回渲染态
- **Escape 键** → 取消编辑，不保存，直接切回渲染态

序列化单个节点的方式（NodeView 内部使用）：
```ts
// Node → Markdown
const doc = schema.node('doc', null, [node])
defaultMarkdownSerializer.serialize(doc).trim()

// Markdown → Node[]
const doc = defaultMarkdownParser.parse(md.trim() + '\n')
const nodes: PMNode[] = []
doc?.forEach(n => nodes.push(n))
```

NodeView 必须实现：
- `update(node)` → 返回 `true` 复用实例，更新渲染；类型不匹配返回 `false`
- `stopEvent(event)` → textarea 获得焦点时拦截所有事件，防止 PM 干扰
- `ignoreMutation()` → 返回 `true`，我们自己管理 DOM

### ProseMirror 插件规划

在 `plugins.ts` 中组合以下插件：
- `history()` — 撤销/重做（Ctrl+Z / Ctrl+Shift+Z）
- `keymap(baseKeymap)` — 基础键绑定
- `keymap({ ... })` — 自定义快捷键（加粗、斜体等）
- `inputRules(...)` — 输入触发规则，例如 `# ` 自动变 heading、`**` 触发 bold

### Schema 说明

直接使用 `prosemirror-markdown` 导出的 `schema`，它已包含：
`doc`, `paragraph`, `blockquote`, `horizontal_rule`, `heading`, `code_block`,
`ordered_list`, `bullet_list`, `list_item`, `text`, `image`, `hard_break`,
`em`, `strong`, `code`, `link`

如需扩展（如 task list、table），在此 schema 基础上用 `schema.spec` 克隆并添加新节点/Mark。

## 文件 I/O（IPC 设计）

**Main 进程注册（`src/main/index.ts`）：**
```ts
ipcMain.handle('file:open', async () => {
  const { filePaths } = await dialog.showOpenDialog({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (!filePaths[0]) return null
  return { path: filePaths[0], content: fs.readFileSync(filePaths[0], 'utf-8') }
})

ipcMain.handle('file:save', async (_e, path: string, content: string) => {
  fs.writeFileSync(path, content, 'utf-8')
})

ipcMain.handle('file:saveAs', async (_e, content: string) => {
  const { filePath } = await dialog.showSaveDialog({ filters: [{ name: 'Markdown', extensions: ['md'] }] })
  if (!filePath) return null
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
})
```

**Preload 暴露（`src/preload/index.ts`）：**
```ts
contextBridge.exposeInMainWorld('api', {
  file: {
    open: () => ipcRenderer.invoke('file:open'),
    save: (path: string, content: string) => ipcRenderer.invoke('file:save', path, content),
    saveAs: (content: string) => ipcRenderer.invoke('file:saveAs', content),
  }
})
```

**类型声明（`src/preload/index.d.ts`）：**
```ts
interface Window {
  api: {
    file: {
      open(): Promise<{ path: string; content: string } | null>
      save(path: string, content: string): Promise<void>
      saveAs(content: string): Promise<string | null>
    }
  }
}
```
