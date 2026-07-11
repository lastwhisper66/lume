# Lume Single-Document Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Lume's tabbed document model with one current Markdown document, auto-save before replacement, show dropped files in the sidebar, and display the current filename in a centered top navigation bar.

**Architecture:** Zustand owns one `WorkspaceDocument | null` and serializes all open requests through a shared replacement operation. Renderer consumers derive editor, outline, word count, exit protection, and navigation title directly from that document. The existing tab row is replaced by a passive document navigation header, while the main process builds a displayable tree for every dropped Markdown file.

**Tech Stack:** Electron IPC, React 19, TypeScript, Zustand, ProseMirror, CSS, ESLint, electron-vite

---

> **Correction (2026-07-11):** The implemented `DocumentHeader` is renderer content inside Electron's hidden `titleBarOverlay`, not a separate page navigation row. Native window controls remain in place, the sidebar and main pane reserve a 38px top inset, `window:setTitle` keeps the native title current, and the overlay colors follow the renderer's computed theme variables through `window:setTitleBarOverlay`. The task text below is retained as historical planning context.

## File map

- Modify `src/main/index.ts`: return a complete dropped-file tree and keep all dropped paths authorized for file IO.
- Modify `src/preload/index.ts`: keep the dropped result contract aligned with the main process.
- Modify `src/renderer/src/store/workspace.ts`: replace tabs with one current document and centralize save-before-open behavior.
- Modify `src/renderer/src/App.tsx`: use current-document dirty state and replace `TabBar` with the navigation header.
- Create `src/renderer/src/components/Navigation/DocumentHeader.tsx`: render the centered current filename.
- Delete `src/renderer/src/components/Tabs/TabBar.tsx`: remove tab switching and closing UI.
- Modify `src/renderer/src/components/Editor/index.tsx`: bind the ProseMirror view to the current document.
- Modify `src/renderer/src/components/Outline/Outline.tsx`: derive headings from the current document.
- Modify `src/renderer/src/components/StatusBar/StatusBar.tsx`: derive word count from the current document.
- Modify `src/renderer/src/styles/structure.css`: replace tab styles with centered navigation-header styles.
- Modify `CLAUDE.md`: describe the current single-document runtime architecture.

### Task 1: Return every dropped Markdown file in the sidebar tree

**Files:**

- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Inspect the current dropped-result type and handler**

Run:

```powershell
Get-Content -Raw src/preload/index.ts
rg -n "openDropped|DroppedResult|readMarkdownTree" src/main/index.ts src/preload/index.ts
```

Expected: `DroppedResult` exposes one optional folder plus a flat `files` list, and the main process only supplies a folder tree for the first dropped directory.

- [ ] **Step 2: Extend the dropped result with a complete display tree**

Define the preload contract as:

```ts
export interface DroppedResult {
  root: string | null
  tree: FileNode[]
  files: string[]
}
```

In `src/main/index.ts`, build `tree` in input order:

- For a dropped directory, add a directory node whose children come from `readMarkdownTree` and append its Markdown leaf paths to `files` in tree order.
- For a dropped Markdown file, add a leaf node and append its path to `files`.
- Deduplicate both displayed leaf paths and `files` by resolved absolute path.
- Add every directory root and every standalone file parent to `workspaceRoots`.
- Return `root` only when exactly one dropped directory supplies the natural workspace root; otherwise return `null` so the renderer can present a neutral dropped-files collection.

Use a helper that flattens a `FileNode[]` deterministically:

```ts
function collectMarkdownPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.isDir ? collectMarkdownPaths(node.children ?? []) : [node.path]
  )
}
```

- [ ] **Step 3: Type-check the IPC contract**

Run:

```powershell
npm run typecheck:node
```

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 4: Commit the dropped-tree change**

```powershell
git add src/main/index.ts src/preload/index.ts
git commit -m "feat: expose all dropped markdown files"
```

### Task 2: Replace the tab store with one current document

**Files:**

- Modify: `src/renderer/src/store/workspace.ts`

- [ ] **Step 1: Replace tab types and actions**

Use this public state shape:

```ts
export interface WorkspaceDocument {
  filePath: string
  title: string
  dirty: boolean
  editorState: EditorState
}

interface WorkspaceStore {
  root: string | null
  tree: FileNode[]
  document: WorkspaceDocument | null
  openFolder: () => Promise<void>
  openFile: (path: string) => Promise<boolean>
  openFileByDialog: () => Promise<void>
  openDropped: (files: File[]) => Promise<void>
  updateDocumentState: (state: EditorState) => void
  saveActive: () => Promise<boolean>
}
```

Delete `tabs`, `activeTabId`, `setActive`, `updateTabState`, and `closeTab`.

- [ ] **Step 2: Implement save-before-open without losing state**

Implement one `openFile(path)` flow:

```ts
openFile: async (path) => {
  const current = get().document
  if (current?.filePath === path) return true

  if (current?.dirty) {
    const saved = await get().saveActive()
    if (!saved) {
      window.alert('自动保存失败，请手动保存后再进行操作')
      return false
    }
  }

  try {
    const content = await window.api.file.read(path)
    set({
      document: {
        filePath: path,
        title: path.split(/[\\/]/).pop() ?? path,
        dirty: false,
        editorState: makeState(content)
      }
    })
    return true
  } catch (error) {
    window.alert(`打开失败：${String(error)}`)
    return false
  }
}
```

`saveActive()` must return `true` when there is no document or saving succeeds, return `false` on failure, clear `dirty` only for the same file that was saved, and retain the existing detailed manual-save alert `保存失败：…`. To avoid two alerts during automatic save, factor the write into a private helper that returns success and let `openFile` own the automatic-save message while `saveActive` owns the manual-save message.

- [ ] **Step 3: Update editing and dropped-file behavior**

Implement `updateDocumentState(state)` as a functional update that ignores the transaction if no document exists and otherwise marks dirty only when the ProseMirror document changed.

Implement `openDropped(files)` so it:

```ts
const paths = files.map((file) => window.api.dnd.pathForFile(file)).filter(Boolean)
if (paths.length === 0) return
const result = await window.api.workspace.openDropped(paths)
set({ root: result.root, tree: result.tree })
if (result.files[0]) await get().openFile(result.files[0])
```

This updates the sidebar with all dropped Markdown files but opens only the first returned path.

- [ ] **Step 4: Run renderer type-check to expose every stale tab consumer**

Run:

```powershell
npm run typecheck:web
```

Expected: FAIL only in consumers still referencing `tabs`, `activeTabId`, `updateTabState`, or `TabBar`; the store itself must have no type errors.

- [ ] **Step 5: Commit the single-document store**

```powershell
git add src/renderer/src/store/workspace.ts
git commit -m "refactor: replace tabs with current document"
```

### Task 3: Bind editor metadata consumers to the current document

**Files:**

- Modify: `src/renderer/src/components/Editor/index.tsx`
- Modify: `src/renderer/src/components/Outline/Outline.tsx`
- Modify: `src/renderer/src/components/StatusBar/StatusBar.tsx`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Update the ProseMirror editor binding**

Read:

```ts
const filePath = useWorkspace((state) => state.document?.filePath)
const editorState = useWorkspace((state) => state.document?.editorState)
const updateDocumentState = useWorkspace((state) => state.updateDocumentState)
```

Create the view from `editorState`, dispatch transactions through `updateDocumentState(newState)`, and key the effect on `filePath`. Keep the existing empty state when no editor state exists.

- [ ] **Step 2: Update outline and word-count selectors**

Both components must select:

```ts
const doc = useWorkspace((state) => state.document?.editorState.doc)
```

Keep their existing `useMemo` derivations and empty behavior unchanged.

- [ ] **Step 3: Update window-close protection**

In `App.tsx`, replace the tab scan with:

```ts
const hasDirty = useWorkspace.getState().document?.dirty === true
```

Keep the existing confirmation message and close handshake.

- [ ] **Step 4: Run renderer type-check**

Run:

```powershell
npm run typecheck:web
```

Expected: remaining errors, if any, are limited to the still-mounted `TabBar` import/component.

- [ ] **Step 5: Commit consumer migration**

```powershell
git add src/renderer/src/App.tsx src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Outline/Outline.tsx src/renderer/src/components/StatusBar/StatusBar.tsx
git commit -m "refactor: read editor state from current document"
```

### Task 4: Replace the tab bar with a centered filename navigation header

**Files:**

- Create: `src/renderer/src/components/Navigation/DocumentHeader.tsx`
- Modify: `src/renderer/src/App.tsx`
- Delete: `src/renderer/src/components/Tabs/TabBar.tsx`
- Modify: `src/renderer/src/styles/structure.css`

- [ ] **Step 1: Create the passive navigation header**

Create:

```tsx
import { useWorkspace } from '../../store/workspace'

export function DocumentHeader(): React.JSX.Element {
  const title = useWorkspace((state) => state.document?.title)

  return (
    <header className="document-header" aria-label="当前文档">
      {title && (
        <span className="document-title" title={title}>
          {title}
        </span>
      )}
    </header>
  )
}

export default DocumentHeader
```

- [ ] **Step 2: Mount the header and remove tabs**

Replace the `TabBar` import and `<TabBar />` in `App.tsx` with `DocumentHeader`. Delete `src/renderer/src/components/Tabs/TabBar.tsx` and remove the empty `Tabs` directory if it contains no other files.

- [ ] **Step 3: Replace tab CSS with centered header CSS**

Delete `.tab-bar`, `.tab`, `.tab-title`, `.tab-dirty`, and `.tab-close` rules. Add:

```css
.document-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 38px;
  min-width: 0;
  height: 38px;
  padding: 0 56px;
  border-bottom: 1px solid var(--lume-border);
  background: var(--lume-bg-sidebar);
}
.document-title {
  display: block;
  max-width: min(60vw, 560px);
  overflow: hidden;
  color: var(--lume-text-muted);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

The row is now navigation metadata rather than an interactive tab strip; no close control or dirty dot remains.

- [ ] **Step 4: Verify types and stale tab references**

Run:

```powershell
npm run typecheck:web
rg -n "tabs|activeTabId|TabBar|setActive|closeTab|tab-bar|tab-close|tab-dirty" src/renderer/src
```

Expected: type-check exits 0 and `rg` returns no stale multi-tab runtime references.

- [ ] **Step 5: Commit the navigation UI**

```powershell
git add src/renderer/src/App.tsx src/renderer/src/components/Navigation/DocumentHeader.tsx src/renderer/src/styles/structure.css
git add -u src/renderer/src/components/Tabs/TabBar.tsx
git commit -m "feat: show current file in navigation header"
```

### Task 5: Update architecture documentation and run full verification

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: Update current architecture documentation**

Change the current runtime description from multi-document tabs to a single `WorkspaceDocument`. Update the file map to replace `Tabs/TabBar.tsx` with `Navigation/DocumentHeader.tsx`, and state that opening a different file auto-saves a dirty current document before replacement. Do not edit historical files under `docs/superpowers/specs` or `docs/superpowers/plans`.

- [ ] **Step 2: Scan for unintended current-code tab references**

Run:

```powershell
rg -n "tabs|activeTabId|TabBar|setActive|closeTab" src CLAUDE.md
```

Expected: no runtime multi-document references. References to ProseMirror tables or sidebar tabs are unrelated and may remain.

- [ ] **Step 3: Run formatting checks and static verification**

Run:

```powershell
npx prettier --check src/main/index.ts src/preload/index.ts src/renderer/src/store/workspace.ts src/renderer/src/App.tsx src/renderer/src/components/Navigation/DocumentHeader.tsx src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Outline/Outline.tsx src/renderer/src/components/StatusBar/StatusBar.tsx src/renderer/src/styles/structure.css CLAUDE.md
npm run lint
npm run typecheck
npm run build
```

Expected: all commands exit 0. If Prettier reports differences, run `npx prettier --write` on exactly the listed changed files, then rerun all four checks.

- [ ] **Step 4: Perform focused manual verification**

Run `npm run dev` and verify:

1. No interactive document tabs or close buttons are visible.
2. The current filename is horizontally centered in the top navigation row; empty state shows no filename; a long name truncates.
3. Opening file B after editing file A writes A to disk before B appears.
4. Force a save failure by making A unwritable or removing its parent media; opening B shows exactly “自动保存失败，请手动保存后再进行操作” and A remains active with its edits.
5. Selecting the current file again does not recreate the editor or trigger a save.
6. Dropping several Markdown files shows every file in the left file view and opens only the first.
7. Outline, word count, Ctrl/Cmd+S, menu open actions, and dirty-window close confirmation still work.

- [ ] **Step 5: Commit documentation and any verification fixes**

```powershell
git add CLAUDE.md src
git commit -m "docs: describe single-document workflow"
```

Only create this commit when there are staged changes; if verification required no fixes and `CLAUDE.md` was already committed with another task, skip the empty commit.
