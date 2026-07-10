# P3 应用外壳（文件树 / 标签页 / dirty / 文件 IO）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 打开一个文件夹作为工作区，侧边树列出 Markdown 文件；点击文件在标签页打开、编辑标记 dirty、`Ctrl+S` 保存；关闭 dirty 标签/窗口时提示。

**Architecture:** Main 进程通过 `ipcMain.handle` 提供 workspace/文件读写；Preload 用 `contextBridge` 暴露 `window.api`；Renderer 用 Zustand 管理 `{ workspaceRoot, fileTree, tabs, activeTabId }`，每个 tab 持有独立 `EditorState`；单一 `EditorView` 随激活 tab `updateState`。

**Tech Stack:** Electron（ipcMain/dialog/fs）、@electron-toolkit/preload、Zustand、ProseMirror。

**验证方式：** 无自动化测试。用 `npm run typecheck` + `npm run dev` 手动走「打开文件夹 → 开文件 → 编辑 → 保存」全链路。

**依赖：** P1 完成（parse/serialize、schema、plugins 可用）。

---

## 文件结构（本阶段涉及）

- Modify: `src/main/index.ts` — 注册 workspace/文件 IPC
- Modify: `src/preload/index.ts` — 暴露 `window.api`
- Modify: `src/preload/index.d.ts` — `window.api` 类型
- Create: `src/renderer/src/store/workspace.ts` — Zustand store
- Modify: `src/renderer/src/components/Editor/index.tsx` — 改为受控于激活 tab 的 EditorState
- Create: `src/renderer/src/components/Workspace/FileTree.tsx` — 侧边文件树
- Create: `src/renderer/src/components/Tabs/TabBar.tsx` — 标签页栏
- Modify: `src/renderer/src/App.tsx` — 三栏布局
- Create: `src/renderer/src/App.css` — 布局样式

---

## Task 1: Main 进程 IPC

**Files:** Modify: `src/main/index.ts`

- [ ] **Step 1: 在文件顶部补 import**

```ts
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
```

（保留原有 `electronApp, optimizer, is` 与 `icon` 的 import。）

- [ ] **Step 2: 加一个递归读取 Markdown 树的函数（放在 createWindow 之上）**

```ts
interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

async function readMarkdownTree(dir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const children = await readMarkdownTree(full)
      if (children.length > 0) nodes.push({ name: entry.name, path: full, isDir: true, children })
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      nodes.push({ name: entry.name, path: full, isDir: false })
    }
  }
  nodes.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  return nodes
}
```

- [ ] **Step 3: 注册 IPC handlers（放在 app.whenReady().then 回调内、createWindow() 之前）**

```ts
  ipcMain.handle('workspace:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled || !filePaths[0]) return null
    const root = filePaths[0]
    const tree = await readMarkdownTree(root)
    return { root, tree }
  })

  ipcMain.handle('file:read', async (_e, path: string) => {
    return fs.readFile(path, 'utf-8')
  })

  ipcMain.handle('file:save', async (_e, path: string, content: string) => {
    await fs.writeFile(path, content, 'utf-8')
  })

  ipcMain.handle('file:saveAs', async (_e, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  })
```

- [ ] **Step 4: 删除示例 `ipcMain.on('ping', ...)` 一行**（可选清理）

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: workspace 与文件读写 IPC handlers"
```

---

## Task 2: Preload 暴露 API

**Files:** Modify: `src/preload/index.ts`

- [ ] **Step 1: 替换 api 定义**

```ts
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const api = {
  workspace: {
    openFolder: (): Promise<{ root: string; tree: FileNode[] } | null> =>
      ipcRenderer.invoke('workspace:openFolder')
  },
  file: {
    read: (path: string): Promise<string> => ipcRenderer.invoke('file:read', path),
    save: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('file:save', path, content),
    saveAs: (content: string): Promise<string | null> =>
      ipcRenderer.invoke('file:saveAs', content)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 可能报 index.d.ts 里 `window.api` 类型不匹配 → 下一 Task 修复。

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: preload 暴露 workspace/file API"
```

---

## Task 3: Preload 类型声明

**Files:** Modify: `src/preload/index.d.ts`

- [ ] **Step 1: 替换内容**

```ts
import type { ElectronAPI } from '@electron-toolkit/preload'
import type { Api } from './index'

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.d.ts
git commit -m "feat: window.api 类型声明"
```

---

## Task 4: Zustand store

**Files:**

- Create: `src/renderer/src/store/workspace.ts`

- [ ] **Step 1: 安装 zustand**

Run: `npm install zustand`
Expected: 安装成功。

- [ ] **Step 2: 写 store/workspace.ts**

```ts
import { create } from 'zustand'
import { EditorState } from 'prosemirror-state'
import type { FileNode } from '../../../preload/index'
import { schema } from '../components/Editor/schema/base'
import { buildPlugins } from '../components/Editor/plugins'
import { parse } from '../components/Editor/markdown/parser'
import { serialize } from '../components/Editor/markdown/serializer'

export interface Tab {
  id: string
  filePath: string
  title: string
  dirty: boolean
  editorState: EditorState
}

interface WorkspaceStore {
  root: string | null
  tree: FileNode[]
  tabs: Tab[]
  activeTabId: string | null

  openFolder: () => Promise<void>
  openFile: (path: string) => Promise<void>
  setActive: (id: string) => void
  updateTabState: (id: string, state: EditorState) => void
  saveActive: () => Promise<void>
  closeTab: (id: string) => void
}

function makeState(markdown: string): EditorState {
  return EditorState.create({ doc: parse(markdown), schema, plugins: buildPlugins() })
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  root: null,
  tree: [],
  tabs: [],
  activeTabId: null,

  openFolder: async () => {
    const res = await window.api.workspace.openFolder()
    if (!res) return
    set({ root: res.root, tree: res.tree })
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.filePath === path)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const content = await window.api.file.read(path)
    const tab: Tab = {
      id: path,
      filePath: path,
      title: path.split(/[\\/]/).pop() ?? path,
      dirty: false,
      editorState: makeState(content)
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  setActive: (id) => set({ activeTabId: id }),

  updateTabState: (id, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id ? { ...t, editorState: state, dirty: t.dirty || state.doc !== t.editorState.doc } : t
      )
    })),

  saveActive: async () => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    await window.api.file.save(tab.filePath, serialize(tab.editorState.doc))
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)) }))
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab?.dirty && !window.confirm(`「${tab.title}」有未保存改动，仍要关闭吗？`)) return
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTabId =
        s.activeTabId === id ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTabId
      return { tabs, activeTabId }
    })
  }
}))
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/store/workspace.ts package.json package-lock.json
git commit -m "feat: workspace Zustand store"
```

---

## Task 5: Editor 改为受控于激活 tab

**Files:** Modify: `src/renderer/src/components/Editor/index.tsx`

- [ ] **Step 1: 重写 index.tsx**

```tsx
import { useEffect, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { useWorkspace } from '../../store/workspace'
import './Editor.css'

export function Editor(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  const activeTabId = useWorkspace((s) => s.activeTabId)
  const activeState = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId)?.editorState)
  const updateTabState = useWorkspace((s) => s.updateTabState)

  // 创建/销毁 view
  useEffect(() => {
    if (!mountRef.current || !activeState) return
    const view = new EditorView(mountRef.current, {
      state: activeState,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        const id = useWorkspace.getState().activeTabId
        if (id) updateTabState(id, newState)
      }
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅依赖 activeTabId：切换 tab 时重建 view 并加载该 tab 的 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  if (!activeState) {
    return <div className="lume-editor lume-empty">打开一个 Markdown 文件开始编辑</div>
  }
  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
```

> 说明：切换 tab 时 `activeTabId` 变化 → 重建 view 并以该 tab 的 `editorState` 初始化，天然实现「每 tab 独立 state（含 undo 历史、光标）」。

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/index.tsx
git commit -m "refactor: Editor 受控于激活 tab 的 EditorState"
```

---

## Task 6: 文件树组件

**Files:** Create: `src/renderer/src/components/Workspace/FileTree.tsx`

- [ ] **Step 1: 写 FileTree.tsx**

```tsx
import { useWorkspace } from '../../store/workspace'
import type { FileNode } from '../../../preload/index'

function TreeNode({ node }: { node: FileNode }): React.JSX.Element {
  const openFile = useWorkspace((s) => s.openFile)
  if (node.isDir) {
    return (
      <div className="tree-dir">
        <div className="tree-dir-name">{node.name}</div>
        <div className="tree-children">
          {node.children?.map((c) => <TreeNode key={c.path} node={c} />)}
        </div>
      </div>
    )
  }
  return (
    <div className="tree-file" onClick={() => openFile(node.path)}>
      {node.name}
    </div>
  )
}

export function FileTree(): React.JSX.Element {
  const root = useWorkspace((s) => s.root)
  const tree = useWorkspace((s) => s.tree)
  const openFolder = useWorkspace((s) => s.openFolder)

  return (
    <div className="file-tree">
      <button className="open-folder-btn" onClick={openFolder}>
        打开文件夹
      </button>
      {root && <div className="workspace-root">{root.split(/[\\/]/).pop()}</div>}
      {tree.map((n) => <TreeNode key={n.path} node={n} />)}
    </div>
  )
}

export default FileTree
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Workspace/FileTree.tsx
git commit -m "feat: 侧边文件树"
```

---

## Task 7: 标签页栏

**Files:** Create: `src/renderer/src/components/Tabs/TabBar.tsx`

- [ ] **Step 1: 写 TabBar.tsx**

```tsx
import { useWorkspace } from '../../store/workspace'

export function TabBar(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const setActive = useWorkspace((s) => s.setActive)
  const closeTab = useWorkspace((s) => s.closeTab)

  if (tabs.length === 0) return <div className="tab-bar tab-bar-empty" />

  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab' + (t.id === activeTabId ? ' active' : '')}
          onClick={() => setActive(t.id)}
        >
          <span className="tab-title">{t.title}</span>
          <span className="tab-dirty">{t.dirty ? '●' : ''}</span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  )
}

export default TabBar
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Tabs/TabBar.tsx
git commit -m "feat: 标签页栏（含 dirty 标记）"
```

---

## Task 8: 布局与保存快捷键

**Files:**

- Modify: `src/renderer/src/App.tsx`
- Create: `src/renderer/src/App.css`

- [ ] **Step 1: 写 App.css**

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }

.app-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
  grid-template-rows: 100%;
  height: 100vh;
}

.sidebar {
  border-right: 1px solid #e5e5e5;
  overflow-y: auto;
  padding: 8px;
}

.main-pane { display: flex; flex-direction: column; min-width: 0; }

.tab-bar { display: flex; border-bottom: 1px solid #e5e5e5; height: 36px; }
.tab {
  display: flex; align-items: center; gap: 6px;
  padding: 0 10px; border-right: 1px solid #e5e5e5; cursor: pointer; font-size: 13px;
}
.tab.active { background: #f0f0f0; }
.tab-close { color: #999; }
.tab-dirty { color: #e08a00; }

.open-folder-btn { width: 100%; margin-bottom: 8px; }
.workspace-root { font-weight: 600; margin-bottom: 6px; font-size: 12px; color: #666; }
.tree-file { padding: 2px 6px; cursor: pointer; font-size: 13px; border-radius: 4px; }
.tree-file:hover { background: #f0f0f0; }
.tree-dir-name { font-size: 13px; color: #444; padding: 2px 6px; }
.tree-children { padding-left: 12px; }

.lume-empty { color: #999; display: flex; align-items: center; justify-content: center; }
```

- [ ] **Step 2: 写 App.tsx**

```tsx
import { useEffect } from 'react'
import Editor from './components/Editor'
import FileTree from './components/Workspace/FileTree'
import TabBar from './components/Tabs/TabBar'
import { useWorkspace } from './store/workspace'
import './App.css'

function App(): React.JSX.Element {
  const saveActive = useWorkspace((s) => s.saveActive)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveActive])

  return (
    <div className="app-layout">
      <div className="sidebar">
        <FileTree />
      </div>
      <div className="main-pane">
        <TabBar />
        <Editor />
      </div>
    </div>
  )
}

export default App
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: 手动验证全链路**

Run: `npm run dev`
Expected：

- 点「打开文件夹」→ 选一个含 `.md` 的目录 → 侧边树列出文件。
- 点文件 → 新标签页打开并渲染内容。
- 编辑 → 标签标题出现 ●。
- `Ctrl+S` → ● 消失；用外部编辑器确认文件已写入。
- 开多个文件 → 标签切换保留各自光标/内容；关闭 dirty 标签弹确认。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/App.css
git commit -m "feat: 三栏布局与保存快捷键"
```

---

## Task 9: 关闭窗口时的未保存提示

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts` + `src/preload/index.d.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Main 拦截窗口关闭并询问渲染进程**

在 `createWindow()` 内、`mainWindow.on('ready-to-show'...)` 附近加：

```ts
  let allowClose = false
  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow.webContents.send('app:queryClose')
  })
  ipcMain.on('app:confirmClose', () => {
    allowClose = true
    mainWindow.close()
  })
```

- [ ] **Step 2: Preload 暴露关闭协商 API**

在 `api` 对象里加：

```ts
  app: {
    onQueryClose: (cb: () => void): void => {
      ipcRenderer.on('app:queryClose', () => cb())
    },
    confirmClose: (): void => {
      ipcRenderer.send('app:confirmClose')
    }
  }
```

（`index.d.ts` 走 `typeof api` 自动获得类型，无需改。）

- [ ] **Step 3: Renderer 响应**

在 `App.tsx` 的 `useEffect` 里加：

```ts
    window.api.app.onQueryClose(() => {
      const hasDirty = useWorkspace.getState().tabs.some((t) => t.dirty)
      if (!hasDirty || window.confirm('有未保存的文件，仍要退出吗？')) {
        window.api.app.confirmClose()
      }
    })
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 手动验证**

Run: `npm run dev` → 编辑后不保存 → 点窗口关闭 → 弹确认；取消则不退出，确认则退出。

- [ ] **Step 6: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/App.tsx
git commit -m "feat: 关闭窗口时未保存提示"
```

---

## 阶段完成标准

- `npm run typecheck` 通过。
- 打开文件夹 → 文件树 → 打开/编辑/保存/多标签切换/关闭确认 全链路可用。
- dirty 状态在标签与关闭协商中正确反映。
