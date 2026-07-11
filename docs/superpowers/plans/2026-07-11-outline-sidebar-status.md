# Outline Sidebar and Editor Status Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Typora-style file/outline sidebar, outline-only scrolling, a default-hidden sidebar toggle, and live “X 词” statistics.

**Architecture:** Derive outline entries and word counts directly from the active ProseMirror document. Keep rendering in focused React components, and expose the mounted `EditorView` through a tiny renderer-only bridge so outline clicks can scroll without dispatching a selection transaction.

**Tech Stack:** Electron, React 19, TypeScript, Zustand, ProseMirror, CSS custom properties

---

## File Structure

- Create `src/renderer/src/components/Outline/documentInfo.ts`: pure ProseMirror document traversal for headings and word count.
- Create `src/renderer/src/components/Outline/editorScroll.ts`: mounted `EditorView` registration and scroll-only navigation.
- Create `src/renderer/src/components/Outline/Outline.tsx`: outline list and hover-only empty state.
- Create `src/renderer/src/components/Workspace/Sidebar.tsx`: “文件 / 大纲” tabs.
- Create `src/renderer/src/components/StatusBar/StatusBar.tsx`: sidebar toggle and word-count display.
- Modify `src/renderer/src/components/Editor/index.tsx`: register and unregister the active `EditorView`.
- Modify `src/renderer/src/App.tsx`: default-hidden sidebar state and new component composition.
- Modify `src/renderer/src/styles/structure.css`: sidebar tabs, outline, status bar, and hidden layout styling.

The repository intentionally has no test runner. Verification therefore uses TypeScript, ESLint, production build, and explicit manual interaction checks, matching the accepted design.

### Task 1: Add Pure Document-Derivation Utilities

**Files:**
- Create: `src/renderer/src/components/Outline/documentInfo.ts`

- [ ] **Step 1: Create outline types and heading extraction**

```ts
import type { Node as ProseMirrorNode } from 'prosemirror-model'

export interface OutlineEntry {
  text: string
  level: number
  pos: number
}

export function extractOutline(doc: ProseMirrorNode | undefined): OutlineEntry[] {
  if (!doc) return []
  const entries: OutlineEntry[] = []
  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const text = node.textContent.trim()
    if (text) entries.push({ text, level: Number(node.attrs.level), pos })
    return false
  })
  return entries
}
```

- [ ] **Step 2: Add the accepted mixed-language word-count algorithm**

Append to the same file:

```ts
const CJK_CHARACTER = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g
const LATIN_OR_NUMBER_WORD = /[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g

export function countWords(doc: ProseMirrorNode | undefined): number {
  if (!doc) return 0
  const text = doc.textBetween(0, doc.content.size, ' ')
  const cjkCount = text.match(CJK_CHARACTER)?.length ?? 0
  const nonCjkText = text.replace(CJK_CHARACTER, ' ')
  const latinOrNumberCount = nonCjkText.match(LATIN_OR_NUMBER_WORD)?.length ?? 0
  return cjkCount + latinOrNumberCount
}
```

- [ ] **Step 3: Run static verification**

Run: `npm run typecheck:web`

Expected: exit code 0 with no TypeScript diagnostics.

- [ ] **Step 4: Commit the utility**

```bash
git add src/renderer/src/components/Outline/documentInfo.ts
git commit -m "feat: derive outline and word count from documents"
```

### Task 2: Add Scroll-Only Editor Navigation

**Files:**
- Create: `src/renderer/src/components/Outline/editorScroll.ts`
- Modify: `src/renderer/src/components/Editor/index.tsx`

- [ ] **Step 1: Create the editor-view bridge**

```ts
import type { EditorView } from 'prosemirror-view'

let activeEditorView: EditorView | null = null

export function registerEditorView(view: EditorView): () => void {
  activeEditorView = view
  return () => {
    if (activeEditorView === view) activeEditorView = null
  }
}

export function scrollEditorTo(pos: number): void {
  const view = activeEditorView
  if (!view || pos < 0 || pos > view.state.doc.content.size) return
  const selectionBefore = view.state.selection
  const domAtPos = view.domAtPos(pos)
  const target = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  if (!view.state.selection.eq(selectionBefore)) view.updateState(view.state)
}
```

- [ ] **Step 2: Register the mounted `EditorView`**

In `src/renderer/src/components/Editor/index.tsx`, import the bridge:

```ts
import { registerEditorView } from '../Outline/editorScroll'
```

Immediately after constructing `view`, register it and dispose it before destroying the view:

```ts
const unregisterEditorView = registerEditorView(view)
return () => {
  unregisterEditorView()
  view.destroy()
}
```

- [ ] **Step 3: Verify types and lint**

Run: `npm run typecheck:web && npm run lint`

Expected: both commands exit 0; no unused imports or DOM type errors.

- [ ] **Step 4: Commit the scroll bridge**

```bash
git add src/renderer/src/components/Outline/editorScroll.ts src/renderer/src/components/Editor/index.tsx
git commit -m "feat: add scroll-only outline navigation"
```

### Task 3: Build the Outline and Tabbed Sidebar

**Files:**
- Create: `src/renderer/src/components/Outline/Outline.tsx`
- Create: `src/renderer/src/components/Workspace/Sidebar.tsx`

- [ ] **Step 1: Implement the outline component**

```tsx
import { useMemo } from 'react'
import { useWorkspace } from '../../store/workspace'
import { extractOutline } from './documentInfo'
import { scrollEditorTo } from './editorScroll'

export function Outline(): React.JSX.Element {
  const doc = useWorkspace((s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.editorState.doc)
  const entries = useMemo(() => extractOutline(doc), [doc])

  return (
    <div className={`outline-panel${entries.length === 0 ? ' is-empty' : ''}`}>
      {entries.length === 0 ? (
        <div className="outline-empty">大纲内容为空</div>
      ) : (
        entries.map((entry) => (
          <button
            className="outline-item"
            style={{ '--outline-level': entry.level } as React.CSSProperties}
            title={entry.text}
            type="button"
            key={`${entry.pos}-${entry.level}`}
            onClick={() => scrollEditorTo(entry.pos)}
          >
            {entry.text}
          </button>
        ))
      )}
    </div>
  )
}
```

The `.outline-empty` element remains mounted but hidden until `.outline-panel.is-empty:hover` activates it, giving the required hover-only empty message.

- [ ] **Step 2: Implement file/outline sidebar tabs**

```tsx
import { useState } from 'react'
import FileTree from './FileTree'
import { Outline } from '../Outline/Outline'

type SidebarPage = 'files' | 'outline'

export function Sidebar(): React.JSX.Element {
  const [page, setPage] = useState<SidebarPage>('files')
  return (
    <div className="sidebar-shell">
      <div className="sidebar-tabs" role="tablist" aria-label="侧边栏">
        <button className={page === 'files' ? 'active' : ''} type="button" onClick={() => setPage('files')}>文件</button>
        <button className={page === 'outline' ? 'active' : ''} type="button" onClick={() => setPage('outline')}>大纲</button>
      </div>
      <div className="sidebar-content">
        {page === 'files' ? <FileTree /> : <Outline />}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify component types**

Run: `npm run typecheck:web`

Expected: exit code 0; `React.CSSProperties` accepts the custom property assertion.

- [ ] **Step 4: Commit sidebar components**

```bash
git add src/renderer/src/components/Outline/Outline.tsx src/renderer/src/components/Workspace/Sidebar.tsx
git commit -m "feat: add tabbed document outline sidebar"
```

### Task 4: Add the Status Bar and Default-Hidden Layout

**Files:**
- Create: `src/renderer/src/components/StatusBar/StatusBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Implement the status bar**

```tsx
import { useMemo } from 'react'
import { useWorkspace } from '../../store/workspace'
import { countWords } from '../Outline/documentInfo'

interface StatusBarProps {
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function StatusBar({ sidebarVisible, onToggleSidebar }: StatusBarProps): React.JSX.Element {
  const doc = useWorkspace((s) => s.tabs.find((tab) => tab.id === s.activeTabId)?.editorState.doc)
  const words = useMemo(() => countWords(doc), [doc])
  return (
    <div className="status-bar">
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
        title={sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'}
        onClick={onToggleSidebar}
      >
        {sidebarVisible ? '‹' : '›'}
      </button>
      <span className="word-count">{words} 词</span>
    </div>
  )
}
```

- [ ] **Step 2: Compose the new layout in `App.tsx`**

Replace the `FileTree` import with `Sidebar`, add `StatusBar`, and initialize visibility to `false`:

```tsx
import Sidebar from './components/Workspace/Sidebar'
import { StatusBar } from './components/StatusBar/StatusBar'

const [sidebarVisible, setSidebarVisible] = useState(false)
```

Replace the layout body with:

```tsx
{sidebarVisible && (
  <div className="sidebar">
    <Sidebar />
  </div>
)}
<div className="main-pane">
  <TabBar />
  <Editor />
  <StatusBar
    sidebarVisible={sidebarVisible}
    onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
  />
</div>
```

Set the root class dynamically so CSS can switch grid columns:

```tsx
className={`app-layout${sidebarVisible ? ' sidebar-visible' : ''}`}
```

- [ ] **Step 3: Verify state behavior statically**

Run: `npm run typecheck:web && npm run lint`

Expected: both commands exit 0; no stale `FileTree` import remains in `App.tsx`.

- [ ] **Step 4: Commit layout behavior**

```bash
git add src/renderer/src/components/StatusBar/StatusBar.tsx src/renderer/src/App.tsx
git commit -m "feat: add default-hidden sidebar and editor status bar"
```

### Task 5: Style the Sidebar, Outline, and Status Bar

**Files:**
- Modify: `src/renderer/src/styles/structure.css`

- [ ] **Step 1: Change the application grid to default-hidden**

```css
.app-layout { grid-template-columns: 1fr; }
.app-layout.sidebar-visible { grid-template-columns: 260px 1fr; }

.sidebar {
  padding: 0;
  overflow: hidden;
}
```

- [ ] **Step 2: Add sidebar tabs and content scrolling**

```css
.sidebar-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.sidebar-tabs { display: grid; grid-template-columns: 1fr 1fr; height: 48px; flex: 0 0 auto; }
.sidebar-tabs button { border: 0; border-bottom: 1px solid var(--lume-border); background: transparent; color: var(--lume-text-muted); font: inherit; cursor: pointer; }
.sidebar-tabs button.active { color: var(--lume-text); box-shadow: inset 0 -2px 0 var(--lume-text); }
.sidebar-content { flex: 1; min-height: 0; overflow-y: auto; padding: 12px; }
```

- [ ] **Step 3: Add outline and hover-only empty-state styles**

```css
.outline-panel { min-height: 100%; display: flex; flex-direction: column; }
.outline-item { display: block; width: 100%; padding: 5px 8px 5px calc(8px + (var(--outline-level) - 1) * 14px); border: 0; border-radius: 5px; background: transparent; color: var(--lume-text-muted); font: inherit; font-size: 13px; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }
.outline-item:hover { background: var(--lume-bg-hover); color: var(--lume-text); }
.outline-panel.is-empty { align-items: center; justify-content: center; }
.outline-empty { color: var(--lume-text-muted); font-size: 13px; opacity: 0; transition: opacity 120ms ease; }
.outline-panel.is-empty:hover .outline-empty { opacity: 1; }
```

- [ ] **Step 4: Add fixed status-bar styles**

```css
.status-bar { flex: 0 0 30px; display: flex; align-items: center; justify-content: space-between; padding: 0 10px; border-top: 1px solid var(--lume-border); background: var(--lume-bg); color: var(--lume-text-muted); font-size: 12px; }
.sidebar-toggle { border: 0; background: transparent; color: inherit; cursor: pointer; width: 24px; height: 24px; border-radius: 4px; font-size: 20px; line-height: 1; }
.sidebar-toggle:hover { background: var(--lume-bg-hover); color: var(--lume-text); }
.word-count { white-space: nowrap; }
```

- [ ] **Step 5: Run formatter and static checks**

Run: `npx prettier --write src/renderer/src/App.tsx src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Outline src/renderer/src/components/Workspace/Sidebar.tsx src/renderer/src/components/StatusBar src/renderer/src/styles/structure.css`

Run: `npm run typecheck && npm run lint`

Expected: formatter completes; TypeScript and ESLint exit 0.

- [ ] **Step 6: Commit styling**

```bash
git add src/renderer/src/styles/structure.css
git commit -m "style: match Typora outline and status layout"
```

### Task 6: Build and Perform Interaction Verification

**Files:**
- Modify only if verification exposes a defect in the files listed above.

- [ ] **Step 1: Run the production build**

Run: `npm run build`

Expected: node and web typechecks pass and Electron Vite emits main, preload, and renderer bundles.

- [ ] **Step 2: Launch the application**

Run: `npm run dev`

Expected: Lume opens with the sidebar hidden, an editor-area toggle at bottom left, and “0 词” at bottom right.

- [ ] **Step 3: Verify empty-state behavior**

With no file open, expand the sidebar, switch to “大纲”, and confirm the pane is blank until hovered. Confirm “大纲内容为空” appears only while the pointer is inside the empty outline pane and disappears after leaving.

- [ ] **Step 4: Verify outline derivation and navigation**

Open a Markdown document containing H1–H6, duplicate title text, and at least one blank heading. Confirm nonblank headings appear in source order with increasing indentation. Place the caret in a paragraph, click an outline entry, and confirm the heading scrolls into view while the caret and selection remain unchanged.

- [ ] **Step 5: Verify live updates and word counting**

Edit a heading and confirm the outline updates immediately. Enter `你好 world 2026` and confirm it contributes four words: two Chinese characters, one English word, and one numeric word. Switch tabs and confirm both outline and word count follow the active document.

- [ ] **Step 6: Verify themes and restart behavior**

Check light and dark themes. Hide or show the sidebar, restart the application, and confirm it starts hidden regardless of its previous runtime state.

- [ ] **Step 7: Run final static verification**

Run: `npm run typecheck && npm run lint && npm run build`

Expected: all commands exit 0.

- [ ] **Step 8: Commit any verification fixes**

If verification required changes, stage only the affected feature files and commit:

```bash
git add src/renderer/src/App.tsx src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Outline src/renderer/src/components/Workspace/Sidebar.tsx src/renderer/src/components/StatusBar src/renderer/src/styles/structure.css
git commit -m "fix: polish outline and status interactions"
```

If no changes were needed, do not create an empty commit.
