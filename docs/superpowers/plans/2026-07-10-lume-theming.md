# Lume 主题与 CSS 架构 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Lume 建立结构/皮肤分离的 CSS 变量体系，支持明亮/黑暗主题（默认跟随系统、可手动覆盖、记忆选择），并以 Typora 式整 CSS 文件替换支持自定义主题，入口为原生「主题」菜单。

**Architecture:** 布局结构 CSS（`structure.css` / `editor.css`）始终内置且只用 `var(--lume-*)`；主题文件（内置 `light.css` / `dark.css` 及用户自定义）定义这些变量，运行时由主进程读文件、经 IPC 推给渲染进程注入 `<style id="lume-theme">`。主进程 `ThemeManager` 持有状态（`userData/settings.json`）与主题夹（`userData/themes/`），原生菜单驱动切换，`nativeTheme` 监听实现跟随系统。CodeMirror 代码块用单份变量驱动主题 + HighlightStyle 自动跟随明暗。

**Tech Stack:** Electron + electron-vite + React 19 + TypeScript + ProseMirror + CodeMirror 6；新增依赖 `@lezer/highlight`（CodeMirror 高亮 tag）。

**验证约定：** 本仓库无 test runner（见 `CLAUDE.md`）。每个任务的验证 = `npm run typecheck` + `npm run lint`，涉及 UI 处追加 `npm run dev` 手动冒烟。每个任务末尾 commit。

**对 spec 的一处细化：** spec §11 提到把 `resources/themes` 加入 electron-builder `extraResources`；本计划改用 Vite `?raw` 把内置主题内联进主进程 bundle，**无需** `extraResources`，规避打包后路径解析问题。

---

## 文件结构

**新建：**

- `resources/themes/light.css` — 内置浅色主题（完整 `--lume-*` 定义）
- `resources/themes/dark.css` — 内置深色主题（完整 `--lume-*` 定义）
- `src/renderer/src/styles/fallback.css` — 变量兜底默认（= 浅色），防 FOUC
- `src/renderer/src/styles/structure.css` — 应用外壳布局（无写死色值）
- `src/renderer/src/styles/editor.css` — 编辑器正文结构（无写死色值）
- `src/renderer/src/theme/injectTheme.ts` — 渲染进程主题注入器
- `src/main/theme.ts` — 主进程 `ThemeManager`
- `src/main/menu.ts` — 原生「主题」菜单构建
- `src/main/env.d.ts` — `*?raw` 模块类型声明

**修改：**

- `src/renderer/src/assets/main.css` — 改为 @import 各样式层 + 全局基线
- `src/renderer/src/assets/base.css` — 移除 electron-vite 残留 token，保留最小 reset
- `src/renderer/src/App.tsx` — 移除 `import './App.css'`
- `src/renderer/src/components/Editor/index.tsx` — 移除 `import './Editor.css'`
- `src/renderer/src/components/Editor/nodeviews/codeblock.ts` — 变量驱动 CM 主题
- `src/renderer/src/main.tsx` — 启动调用 `initTheme()`
- `src/main/index.ts` — 接入 ThemeManager / 菜单 / IPC / nativeTheme
- `src/preload/index.ts` — 暴露 `window.api.theme.*`
- `src/preload/index.d.ts` — 无需改（`Api` 由 `typeof api` 推导）

**删除：**

- `src/renderer/src/App.css`（内容迁入 `structure.css`）
- `src/renderer/src/components/Editor/Editor.css`（内容迁入 `editor.css`）

---

## Task 1: 内置主题文件与兜底变量

建立变量契约的三个 CSS 数据文件。纯数据、无逻辑，先落地以便后续结构 CSS 引用。

**Files:**

- Create: `resources/themes/light.css`
- Create: `resources/themes/dark.css`
- Create: `src/renderer/src/styles/fallback.css`

- [ ] **Step 1: 创建 `resources/themes/light.css`**

```css
/* Lume 内置浅色主题 —— 定义全部 --lume-* 变量契约 */
:root {
  /* 表面 / 背景 */
  --lume-bg: #ffffff;
  --lume-bg-sidebar: #f7f8fa;
  --lume-bg-elevated: #ffffff;
  --lume-bg-code: #f6f8fa;
  --lume-bg-hover: #f0f1f3;
  --lume-bg-active: #e6e8eb;
  --lume-bg-selection: #d7e6ff;

  /* 文字 */
  --lume-text: #2b2b2b;
  --lume-text-muted: #8a8a8a;
  --lume-text-faint: #b8b8b8;
  --lume-link: #3b6fd6;
  --lume-text-code: #24292e;

  /* 边框 / 强调 / 状态 */
  --lume-border: #ececec;
  --lume-border-strong: #d8d8d8;
  --lume-accent: #3b82f6;
  --lume-accent-hover: #2f74e6;
  --lume-dirty: #e08a00;

  /* 编辑器专属 */
  --lume-marker: #b8b8b8;
  --lume-table-header-bg: #f7f7f7;
  --lume-table-border: #dddddd;
  --lume-blockquote-border: #dfe2e6;
  --lume-hr: #e2e2e2;

  /* 代码语法高亮 */
  --lume-code-keyword: #d73a49;
  --lume-code-string: #032f62;
  --lume-code-comment: #6a737d;
  --lume-code-number: #005cc5;
  --lume-code-function: #6f42c1;
  --lume-code-type: #22863a;
  --lume-code-tag: #22863a;
  --lume-code-attribute: #6f42c1;
  --lume-code-operator: #24292e;

  /* 排版 */
  --lume-font-ui: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-content: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --lume-content-width: 780px;
  --lume-font-size: 16px;
}
```

- [ ] **Step 2: 创建 `resources/themes/dark.css`**

```css
/* Lume 内置深色主题 —— 覆盖全部 --lume-* 变量契约 */
:root {
  /* 表面 / 背景 */
  --lume-bg: #1e1e1e;
  --lume-bg-sidebar: #181818;
  --lume-bg-elevated: #252526;
  --lume-bg-code: #262626;
  --lume-bg-hover: #2a2d2e;
  --lume-bg-active: #37373d;
  --lume-bg-selection: #264f78;

  /* 文字 */
  --lume-text: #d4d4d4;
  --lume-text-muted: #8a8a8a;
  --lume-text-faint: #5a5a5a;
  --lume-link: #4aa3ff;
  --lume-text-code: #c9d1d9;

  /* 边框 / 强调 / 状态 */
  --lume-border: #2b2b2b;
  --lume-border-strong: #3a3a3a;
  --lume-accent: #4a9eff;
  --lume-accent-hover: #6cb0ff;
  --lume-dirty: #e0a030;

  /* 编辑器专属 */
  --lume-marker: #6a6a6a;
  --lume-table-header-bg: #262626;
  --lume-table-border: #3a3a3a;
  --lume-blockquote-border: #3a3a3a;
  --lume-hr: #3a3a3a;

  /* 代码语法高亮 */
  --lume-code-keyword: #ff7b72;
  --lume-code-string: #a5d6ff;
  --lume-code-comment: #8b949e;
  --lume-code-number: #79c0ff;
  --lume-code-function: #d2a8ff;
  --lume-code-type: #7ee787;
  --lume-code-tag: #7ee787;
  --lume-code-attribute: #d2a8ff;
  --lume-code-operator: #c9d1d9;

  /* 排版 */
  --lume-font-ui: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-content: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --lume-content-width: 780px;
  --lume-font-size: 16px;
}
```

- [ ] **Step 3: 创建 `src/renderer/src/styles/fallback.css`**

内容与 `light.css` 的 `:root` 完全一致（作为主题注入前的首帧兜底，避免白屏）。

```css
/* 主题注入前的兜底变量（= 浅色）。运行时注入的 <style id="lume-theme"> 会以更后的源顺序覆盖此处。 */
:root {
  --lume-bg: #ffffff;
  --lume-bg-sidebar: #f7f8fa;
  --lume-bg-elevated: #ffffff;
  --lume-bg-code: #f6f8fa;
  --lume-bg-hover: #f0f1f3;
  --lume-bg-active: #e6e8eb;
  --lume-bg-selection: #d7e6ff;
  --lume-text: #2b2b2b;
  --lume-text-muted: #8a8a8a;
  --lume-text-faint: #b8b8b8;
  --lume-link: #3b6fd6;
  --lume-text-code: #24292e;
  --lume-border: #ececec;
  --lume-border-strong: #d8d8d8;
  --lume-accent: #3b82f6;
  --lume-accent-hover: #2f74e6;
  --lume-dirty: #e08a00;
  --lume-marker: #b8b8b8;
  --lume-table-header-bg: #f7f7f7;
  --lume-table-border: #dddddd;
  --lume-blockquote-border: #dfe2e6;
  --lume-hr: #e2e2e2;
  --lume-code-keyword: #d73a49;
  --lume-code-string: #032f62;
  --lume-code-comment: #6a737d;
  --lume-code-number: #005cc5;
  --lume-code-function: #6f42c1;
  --lume-code-type: #22863a;
  --lume-code-tag: #22863a;
  --lume-code-attribute: #6f42c1;
  --lume-code-operator: #24292e;
  --lume-font-ui: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-content: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
  --lume-font-mono: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace;
  --lume-content-width: 780px;
  --lume-font-size: 16px;
}
```

- [ ] **Step 4: Commit**

```bash
git add resources/themes/light.css resources/themes/dark.css src/renderer/src/styles/fallback.css
git commit -m "feat(theme): 内置明暗主题与兜底变量契约"
```

---

## Task 2: 结构/正文 CSS 迁移到变量

把 `App.css` / `Editor.css` 的规则迁入 `structure.css` / `editor.css`，所有写死色值改 `var(--lume-*)`；重写 `main.css` / `base.css`；删旧文件并更新 import。

**Files:**

- Create: `src/renderer/src/styles/structure.css`
- Create: `src/renderer/src/styles/editor.css`
- Modify: `src/renderer/src/assets/main.css`
- Modify: `src/renderer/src/assets/base.css`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/components/Editor/index.tsx`
- Delete: `src/renderer/src/App.css`
- Delete: `src/renderer/src/components/Editor/Editor.css`

- [ ] **Step 1: 创建 `src/renderer/src/styles/structure.css`**

```css
* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }

.app-layout {
  display: grid;
  grid-template-columns: 260px 1fr;
  grid-template-rows: 100%;
  height: 100vh;
  background: var(--lume-bg);
  color: var(--lume-text);
  font-family: var(--lume-font-ui);
}

/* ---------- Sidebar ---------- */
.sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--lume-border);
  background: var(--lume-bg-sidebar);
  overflow-y: auto;
  padding: 12px;
}
.file-tree { display: flex; flex-direction: column; }
.open-folder-btn {
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px solid var(--lume-border);
  border-radius: 8px;
  background: var(--lume-bg);
  color: var(--lume-text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease;
}
.open-folder-btn:hover { background: var(--lume-bg-hover); border-color: var(--lume-border-strong); }
.open-folder-btn:active { background: var(--lume-bg-active); }
.workspace-root {
  margin: 4px 4px 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--lume-text-muted);
}
.tree-file {
  padding: 4px 8px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 6px;
  color: var(--lume-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-file:hover { background: var(--lume-bg-hover); }
.tree-dir-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--lume-text-muted);
  padding: 4px 8px;
}
.tree-children { padding-left: 12px; }

/* ---------- Main pane ---------- */
.main-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--lume-bg);
}

/* ---------- Tab bar ---------- */
.tab-bar {
  display: flex;
  align-items: stretch;
  height: 38px;
  border-bottom: 1px solid var(--lume-border);
  background: var(--lume-bg-sidebar);
  overflow-x: auto;
}
.tab {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 200px;
  padding: 0 12px;
  border-right: 1px solid var(--lume-border);
  cursor: pointer;
  font-size: 13px;
  color: var(--lume-text-muted);
  transition: background 0.15s ease, color 0.15s ease;
}
.tab:hover { background: var(--lume-bg-hover); }
.tab.active {
  background: var(--lume-bg);
  color: var(--lume-text);
  box-shadow: inset 0 -2px 0 var(--lume-accent);
}
.tab-title { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tab-dirty { color: var(--lume-dirty); }
.tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--lume-text-muted);
  line-height: 1;
}
.tab-close:hover { background: var(--lume-bg-active); color: var(--lume-text); }

/* ---------- Empty state ---------- */
.lume-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--lume-text-muted);
  font-size: 15px;
}
```

- [ ] **Step 2: 创建 `src/renderer/src/styles/editor.css`**

```css
.lume-editor {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
  padding: 24px 40px;
  box-sizing: border-box;
  background: var(--lume-bg);
  color: var(--lume-text);
}

.lume-editor .ProseMirror {
  outline: none;
  max-width: var(--lume-content-width);
  margin: 0 auto;
  line-height: 1.7;
  font-size: var(--lume-font-size);
  font-family: var(--lume-font-content);
}
.lume-editor .ProseMirror > * + * { margin-top: 0.75em; }
.lume-editor .ProseMirror pre {
  background: var(--lume-bg-code);
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
}
.lume-editor .ProseMirror code {
  background: var(--lume-bg-code);
  color: var(--lume-text-code);
  font-family: var(--lume-font-mono);
  font-size: 85%;
  padding: 2px 5px;
  border-radius: 4px;
}
.lume-editor .ProseMirror pre code {
  background: none;
  padding: 0;
}
.lume-editor .ProseMirror a { color: var(--lume-link); }
.lume-editor .ProseMirror blockquote {
  border-left: 3px solid var(--lume-blockquote-border);
  padding-left: 12px;
  color: var(--lume-text-muted);
}
.lume-editor .ProseMirror hr { border: none; border-top: 1px solid var(--lume-hr); }

.md-marker {
  color: var(--lume-marker);
  user-select: none;
  font-family: var(--lume-font-mono);
}
.md-marker-block { display: block; }

.lume-editor table {
  border-collapse: collapse;
  width: 100%;
}
.lume-editor th,
.lume-editor td {
  border: 1px solid var(--lume-table-border);
  padding: 6px 10px;
}
.lume-editor th {
  background: var(--lume-table-header-bg);
  font-weight: 600;
}
.lume-editor li[data-checked] { list-style: none; }
.lume-editor li[data-checked]::before { content: '☐'; margin-right: 6px; }
.lume-editor li[data-checked='true']::before { content: '☑'; }

.cm-code-block {
  border: 1px solid var(--lume-border);
  border-radius: 6px;
  margin: 0.75em 0;
  overflow: hidden;
}
.cm-code-block .cm-editor { font-size: 14px; }
.cm-code-block .cm-focused { outline: none; }

.lume-image img {
  max-width: 100%;
  cursor: pointer;
  border-radius: 4px;
}
.lume-image-src {
  width: 100%;
  font-family: var(--lume-font-mono);
  font-size: 13px;
  padding: 4px 6px;
  background: var(--lume-bg-code);
  color: var(--lume-text);
  border: 1px solid var(--lume-border);
}
```

- [ ] **Step 3: 重写 `src/renderer/src/assets/main.css`**

替换整个文件内容为：

```css
@import './base.css';
@import './styles/fallback.css';
@import './styles/structure.css';
@import './styles/editor.css';

body {
  min-height: 100vh;
  overflow: hidden;
  user-select: none;
  background: var(--lume-bg);
  color: var(--lume-text);
  font-family: var(--lume-font-ui);
  -webkit-font-smoothing: antialiased;
}

#root {
  height: 100vh;
}
```

- [ ] **Step 4: 重写 `src/renderer/src/assets/base.css`**

替换整个文件内容为最小 reset（移除 electron-vite 的 `--ev-c-*` / `--color-*` token）：

```css
*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  font-weight: normal;
}

ul {
  list-style: none;
}

body {
  min-height: 100vh;
  line-height: 1.6;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 5: 从 `src/renderer/src/App.tsx` 移除 App.css 引入**

删除这一行：

```ts
import './App.css'
```

（`main.css` 已通过 @import 引入 `structure.css`，全局生效。）

- [ ] **Step 6: 从 `src/renderer/src/components/Editor/index.tsx` 移除 Editor.css 引入**

删除这一行（**保留** `prosemirror-tables/style/tables.css` 那一行）：

```ts
import './Editor.css'
```

- [ ] **Step 7: 删除旧样式文件**

```bash
git rm src/renderer/src/App.css src/renderer/src/components/Editor/Editor.css
```

- [ ] **Step 8: 校验类型与 lint**

Run: `npm run typecheck; npm run lint`
Expected: 均通过、无错误。

- [ ] **Step 9: 手动冒烟**

Run: `npm run dev`
Expected: 应用为浅色主题、布局正常（侧边栏 260px、标签栏、空状态居中）；打开一个 .md 文件，正文/代码块/表格显示正常。

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(css): 结构/正文样式迁入变量体系，清理脚手架残留"
```

---

## Task 3: CodeMirror 变量驱动主题

把代码块从 `defaultHighlightStyle` 换成变量驱动的 `HighlightStyle` + `EditorView.theme`，使代码高亮随主题明暗自动变色。

**Files:**

- Modify: `package.json`（新增 `@lezer/highlight` 依赖）
- Modify: `src/renderer/src/components/Editor/nodeviews/codeblock.ts`

- [ ] **Step 1: 安装 `@lezer/highlight`**

Run: `npm install @lezer/highlight`
Expected: 安装成功，`package.json` dependencies 出现 `@lezer/highlight`。

- [ ] **Step 2: 修改 codeblock.ts 的 import**

把顶部 `@codemirror/language` 的引入改为（去掉 `defaultHighlightStyle`，加入 `HighlightStyle`），并新增 `@lezer/highlight` 的 `tags`：

将：

```ts
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
```

改为：

```ts
import {
  syntaxHighlighting,
  HighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
```

- [ ] **Step 3: 在 import 之后、`export class CodeBlockView` 之前插入变量驱动主题定义**

```ts
// 变量驱动的 CodeMirror 主题：颜色全部走 --lume-* 变量，随 Lume 主题明暗自动切换
const lumeCmHighlight = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--lume-code-keyword)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--lume-code-string)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--lume-code-comment)', fontStyle: 'italic' },
  { tag: [t.number, t.bool, t.null], color: 'var(--lume-code-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--lume-code-function)' },
  { tag: [t.typeName, t.className, t.namespace], color: 'var(--lume-code-type)' },
  { tag: t.tagName, color: 'var(--lume-code-tag)' },
  { tag: t.attributeName, color: 'var(--lume-code-attribute)' },
  { tag: [t.operator, t.punctuation], color: 'var(--lume-code-operator)' }
])

const lumeCmTheme = CMView.theme({
  '&': {
    color: 'var(--lume-text-code)',
    backgroundColor: 'var(--lume-bg-code)'
  },
  '.cm-content': { fontFamily: 'var(--lume-font-mono)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--lume-text)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--lume-bg-selection)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--lume-bg-code)',
    color: 'var(--lume-text-faint)',
    border: 'none'
  }
})
```

- [ ] **Step 4: 在 CMState extensions 中替换高亮扩展**

将：

```ts
          cmKeymap.of([...this.codeMirrorKeymap(), ...defaultKeymap, indentWithTab]),
          drawSelection(),
          syntaxHighlighting(defaultHighlightStyle),
          this.langCompartment.of([]),
```

改为：

```ts
          cmKeymap.of([...this.codeMirrorKeymap(), ...defaultKeymap, indentWithTab]),
          drawSelection(),
          lumeCmTheme,
          syntaxHighlighting(lumeCmHighlight),
          this.langCompartment.of([]),
```

- [ ] **Step 5: 校验类型与 lint**

Run: `npm run typecheck; npm run lint`
Expected: 均通过。若 `t.special` / `t.function` 报类型错，确认 `@lezer/highlight` 已安装且版本 ≥ 1.x（其 `Tag` 上有 `special`/`function` 修饰器工厂）。

- [ ] **Step 6: 手动冒烟**

Run: `npm run dev`
Expected: 打开含 ```` ```js ```` 代码块的 .md，代码有语法高亮，背景为 `--lume-bg-code`。

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/Editor/nodeviews/codeblock.ts
git commit -m "feat(editor): CodeMirror 代码块改为变量驱动主题"
```

---

## Task 4: 主进程 ThemeManager

实现主题状态、主题夹初始化、settings 读写、有效主题推导、`nativeTheme` 监听。内置主题用 `?raw` 内联。

**Files:**

- Create: `src/main/env.d.ts`
- Create: `src/main/theme.ts`

- [ ] **Step 1: 创建 `src/main/env.d.ts`（`*?raw` 类型声明）**

```ts
declare module '*?raw' {
  const content: string
  export default content
}
```

- [ ] **Step 2: 创建 `src/main/theme.ts`**

```ts
import { app, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import lightCss from '../../resources/themes/light.css?raw'
import darkCss from '../../resources/themes/dark.css?raw'

export interface ThemeSettings {
  themeMode: 'system' | 'manual'
  manualTheme: string
  dayTheme: string
  nightTheme: string
}

export interface ThemePayload {
  name: string
  css: string
}

const DEFAULT_SETTINGS: ThemeSettings = {
  themeMode: 'system',
  manualTheme: 'light',
  dayTheme: 'light',
  nightTheme: 'dark'
}

const BUILTIN: Record<string, string> = { light: lightCss, dark: darkCss }

export class ThemeManager {
  private themesDir = join(app.getPath('userData'), 'themes')
  private settingsFile = join(app.getPath('userData'), 'settings.json')
  private settings: ThemeSettings = { ...DEFAULT_SETTINGS }
  private onChange: () => void = () => {}

  /** 初始化：建主题夹、拷内置主题（缺失才拷）、读 settings、挂 nativeTheme 监听 */
  async init(onChange: () => void): Promise<void> {
    this.onChange = onChange
    await fs.mkdir(this.themesDir, { recursive: true })
    for (const [name, css] of Object.entries(BUILTIN)) {
      const p = join(this.themesDir, `${name}.css`)
      try {
        await fs.access(p)
      } catch {
        await fs.writeFile(p, css, 'utf-8')
      }
    }
    this.settings = await this.readSettings()
    nativeTheme.on('updated', () => {
      if (this.settings.themeMode === 'system') this.onChange()
    })
  }

  private async readSettings(): Promise<ThemeSettings> {
    try {
      const raw = await fs.readFile(this.settingsFile, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ThemeSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private async writeSettings(): Promise<void> {
    await fs.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8')
  }

  getState(): ThemeSettings {
    return this.settings
  }

  private effectiveName(): string {
    if (this.settings.themeMode === 'manual') return this.settings.manualTheme
    return nativeTheme.shouldUseDarkColors ? this.settings.nightTheme : this.settings.dayTheme
  }

  /** 只允许简单文件名，防路径越界 */
  private safeThemePath(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '')
    return join(this.themesDir, `${safe}.css`)
  }

  async listThemes(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.themesDir)
      return files
        .filter((f) => f.toLowerCase().endsWith('.css'))
        .map((f) => f.replace(/\.css$/i, ''))
        .sort()
    } catch {
      return ['light', 'dark']
    }
  }

  /** 当前有效主题的名字与 CSS 文本；读不到则回退内置浅色 */
  async currentCss(): Promise<ThemePayload> {
    const name = this.effectiveName()
    try {
      const css = await fs.readFile(this.safeThemePath(name), 'utf-8')
      return { name, css }
    } catch {
      return { name: 'light', css: BUILTIN.light }
    }
  }

  async select(name: string): Promise<void> {
    this.settings.themeMode = 'manual'
    this.settings.manualTheme = name
    await this.writeSettings()
    this.onChange()
  }

  async setMode(patch: Partial<ThemeSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await this.writeSettings()
    this.onChange()
  }

  /** 手动重新扫描主题夹（触发菜单重建与主题重推） */
  rescan(): void {
    this.onChange()
  }

  openFolder(): void {
    void shell.openPath(this.themesDir)
  }
}
```

- [ ] **Step 3: 校验类型**

Run: `npm run typecheck:node`
Expected: 通过（`*?raw` 声明生效，`theme.ts` 无类型错误）。

- [ ] **Step 4: Commit**

```bash
git add src/main/env.d.ts src/main/theme.ts
git commit -m "feat(main): 新增 ThemeManager 与主题状态管理"
```

---

## Task 5: 原生「主题」菜单

用 `ThemeManager` 的状态构建原生应用菜单，含跟随系统、主题 radio、日/夜主题子菜单、打开文件夹、重新扫描。

**Files:**

- Create: `src/main/menu.ts`

- [ ] **Step 1: 创建 `src/main/menu.ts`**

```ts
import { Menu, type MenuItemConstructorOptions } from 'electron'
import type { ThemeManager } from './theme'

/** 依据当前主题状态构建并设置应用菜单（勾选态即时反映） */
export async function buildAppMenu(tm: ThemeManager): Promise<void> {
  const themes = await tm.listThemes()
  const state = tm.getState()

  const themeRadios: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.themeMode === 'manual' && state.manualTheme === name,
    click: () => {
      void tm.select(name)
    }
  }))

  const daySubmenu: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.dayTheme === name,
    click: () => {
      void tm.setMode({ dayTheme: name })
    }
  }))

  const nightSubmenu: MenuItemConstructorOptions[] = themes.map((name) => ({
    label: name,
    type: 'radio',
    checked: state.nightTheme === name,
    click: () => {
      void tm.setMode({ nightTheme: name })
    }
  }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: '主题',
      submenu: [
        {
          label: '跟随系统',
          type: 'checkbox',
          checked: state.themeMode === 'system',
          click: () => {
            void tm.setMode({ themeMode: state.themeMode === 'system' ? 'manual' : 'system' })
          }
        },
        { type: 'separator' },
        ...themeRadios,
        { type: 'separator' },
        { label: '日间主题', submenu: daySubmenu },
        { label: '夜间主题', submenu: nightSubmenu },
        { type: 'separator' },
        {
          label: '打开主题文件夹',
          click: () => {
            tm.openFolder()
          }
        },
        {
          label: '重新扫描主题',
          click: () => {
            tm.rescan()
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
```

- [ ] **Step 2: 校验类型**

Run: `npm run typecheck:node`
Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add src/main/menu.ts
git commit -m "feat(main): 原生「主题」菜单"
```

---

## Task 6: 主进程接线（IPC + 菜单 + 推送）

在 `index.ts` 里实例化 ThemeManager，注册 theme IPC，接入菜单构建与主题推送。

**Files:**

- Modify: `src/main/index.ts`

- [ ] **Step 1: 顶部新增 import**

将：

```ts
import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
```

改为（新增 `nativeTheme` 与两个模块 import）：

```ts
import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join, resolve, relative, isAbsolute } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ThemeManager } from './theme'
import { buildAppMenu } from './menu'
```

- [ ] **Step 2: 在 `createWindow` 之前定义 ThemeManager 实例与推送函数**

在 `function createWindow(): void {` 之前插入：

```ts
const themeManager = new ThemeManager()

/** 把当前有效主题推给所有窗口，并重建菜单勾选 */
async function pushTheme(): Promise<void> {
  const payload = await themeManager.currentCss()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('theme:apply', payload)
  }
  await buildAppMenu(themeManager)
}
```

- [ ] **Step 3: 在 `app.whenReady().then(...)` 回调开头初始化主题**

将回调改为 async 并在 `electronApp.setAppUserModelId('com.lume.app')` 之后、`createWindow()` 之前初始化。具体地，把：

```ts
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lume.app')
```

改为：

```ts
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lume.app')

  await themeManager.init(() => {
    void pushTheme()
  })
```

- [ ] **Step 4: 注册 theme IPC（放在其它 ipcMain 注册附近，`createWindow()` 之前）**

在 `ipcMain.handle('file:saveAs', ...)` 那个 handler 之后插入：

```ts
  ipcMain.handle('theme:current', () => themeManager.currentCss())
  ipcMain.handle('theme:list', () => themeManager.listThemes())
  ipcMain.on('theme:select', (_e, name: string) => {
    void themeManager.select(name)
  })
  ipcMain.on('theme:setMode', (_e, patch: Record<string, unknown>) => {
    void themeManager.setMode(patch)
  })
  ipcMain.on('theme:openFolder', () => {
    themeManager.openFolder()
  })
  ipcMain.on('theme:rescan', () => {
    themeManager.rescan()
  })
```

- [ ] **Step 5: `createWindow()` 后构建初始菜单**

将：

```ts
  createWindow()

  app.on('activate', function () {
```

改为：

```ts
  createWindow()
  await buildAppMenu(themeManager)

  app.on('activate', function () {
```

- [ ] **Step 6: 校验类型与 lint**

Run: `npm run typecheck; npm run lint`
Expected: 均通过。注意 `setMode(patch: Record<string, unknown>)` 传入 `ThemeManager.setMode(patch: Partial<ThemeSettings>)` —— 若 lint/类型报不兼容，把 IPC handler 的形参类型改为 `Partial<import('./theme').ThemeSettings>` 并去掉 `Record` 注解。

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(main): 接入主题 IPC、菜单与推送"
```

---

## Task 7: Preload 暴露 theme API

在 preload 暴露 `window.api.theme.*`；类型由 `typeof api` 自动推导，`index.d.ts` 无需改。

**Files:**

- Modify: `src/preload/index.ts`

- [ ] **Step 1: 在 `api` 对象中新增 `theme` 分组**

将 `api` 对象里的 `app: { ... }` 分组之后补一个逗号并加入 `theme` 分组。即把：

```ts
  app: {
    onQueryClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('app:queryClose', listener)
      return () => ipcRenderer.removeListener('app:queryClose', listener)
    },
    confirmClose: (): void => {
      ipcRenderer.send('app:confirmClose')
    }
  }
}
```

改为：

```ts
  app: {
    onQueryClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('app:queryClose', listener)
      return () => ipcRenderer.removeListener('app:queryClose', listener)
    },
    confirmClose: (): void => {
      ipcRenderer.send('app:confirmClose')
    }
  },
  theme: {
    current: (): Promise<{ name: string; css: string }> => ipcRenderer.invoke('theme:current'),
    list: (): Promise<string[]> => ipcRenderer.invoke('theme:list'),
    select: (name: string): void => ipcRenderer.send('theme:select', name),
    setMode: (patch: {
      themeMode?: 'system' | 'manual'
      manualTheme?: string
      dayTheme?: string
      nightTheme?: string
    }): void => ipcRenderer.send('theme:setMode', patch),
    openFolder: (): void => ipcRenderer.send('theme:openFolder'),
    rescan: (): void => ipcRenderer.send('theme:rescan'),
    onApply: (cb: (p: { name: string; css: string }) => void): (() => void) => {
      const listener = (_e: unknown, p: { name: string; css: string }): void => cb(p)
      ipcRenderer.on('theme:apply', listener)
      return () => ipcRenderer.removeListener('theme:apply', listener)
    }
  }
}
```

- [ ] **Step 2: 校验类型**

Run: `npm run typecheck`
Expected: 通过（`Api = typeof api` 自动含 `theme`）。

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): 暴露 window.api.theme.*"
```

---

## Task 8: 渲染进程主题注入器

创建注入器：启动拉取当前主题注入 `<style id="lume-theme">`，并订阅后续变化。在 `main.tsx` render 之前调用。

**Files:**

- Create: `src/renderer/src/theme/injectTheme.ts`
- Modify: `src/renderer/src/main.tsx`

- [ ] **Step 1: 创建 `src/renderer/src/theme/injectTheme.ts`**

```ts
/**
 * 主题注入器：把主进程推来的主题 CSS 注入到 <style id="lume-theme">。
 * 该 <style> 在源顺序上晚于 fallback/structure/editor，故能覆盖兜底变量。
 */
export function initTheme(): void {
  let styleEl = document.getElementById('lume-theme') as HTMLStyleElement | null
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'lume-theme'
    document.head.appendChild(styleEl)
  }
  const apply = (p: { name: string; css: string }): void => {
    styleEl!.textContent = p.css
  }
  void window.api.theme.current().then(apply)
  window.api.theme.onApply(apply)
}
```

- [ ] **Step 2: 在 `main.tsx` 中调用 `initTheme()`**

将：

```ts
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

改为：

```ts
import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initTheme } from './theme/injectTheme'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
```

- [ ] **Step 3: 校验类型与 lint**

Run: `npm run typecheck; npm run lint`
Expected: 均通过。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/theme/injectTheme.ts src/renderer/src/main.tsx
git commit -m "feat(renderer): 主题注入器接入启动流程"
```

---

## Task 9: 端到端验证与收尾

全链路手动验证主题功能，并把关键行为记录到 `CLAUDE.md`（可选）。

**Files:**

- （验证为主，无必改文件）

- [ ] **Step 1: 全量校验**

Run: `npm run typecheck; npm run lint; npm run build`
Expected: 三者均通过（`build` 说明 `?raw` 在主进程打包成功）。

- [ ] **Step 2: 手动端到端冒烟**

Run: `npm run dev`，逐项确认：

- 首帧不白屏；应用样式正常。
- 按 Alt 唤出菜单，「主题」子菜单存在；含「跟随系统」、light/dark radio、日/夜主题子菜单、打开主题文件夹、重新扫描。
- 取消「跟随系统」并选 `dark` → 界面（含侧边栏/标签/编辑器/代码块/表格）整体变深色。
- 重启 `npm run dev` → 仍为上次选择的 dark（记忆生效）。
- 勾回「跟随系统」→ 切换系统明暗设置，界面随之切换（Windows：设置→个性化→颜色→模式）。
- 「打开主题文件夹」打开 `userData/themes`，其中有 `light.css`、`dark.css`。
- 复制 `dark.css` 为 `mytheme.css`、改几个变量 → 菜单「重新扫描主题」→ 出现 `mytheme` 可选并生效。
- 删除 `userData/themes/dark.css` 后「重新扫描」→ 引用 dark 时回退不崩溃。

- [ ] **Step 3: （可选）在 CLAUDE.md 记录主题机制**

在 `CLAUDE.md` 适当位置补一句主题架构说明（结构/皮肤分离、主题夹位置、原生菜单入口）。若做，则：

```bash
git add CLAUDE.md
git commit -m "docs: 记录主题机制"
```

- [ ] **Step 4: 汇报完成**

确认全部验证通过，向用户汇报改动的文件与主题使用方式。

---

## 自查（对照 spec）

- spec §3 结构/皮肤分离 → Task 2（structure/editor 只用 var）+ Task 1（主题定义 var）✓
- spec §4 变量契约 → Task 1 完整落地全部分组 ✓
- spec §5 状态与持久化 → Task 4 `settings.json` + `ThemeSettings` ✓
- spec §6 IPC 契约 → Task 6（main handlers）+ Task 7（preload）✓
- spec §7 原生菜单 → Task 5 + Task 6 初始/重建 ✓
- spec §8 跟随系统 → Task 4 `nativeTheme.on('updated')` ✓
- spec §9 CodeMirror 变量驱动 → Task 3 ✓
- spec §10 默认配色 → Task 1 light/dark 完整值 ✓
- spec §11 现有代码改造 → Task 2/3/6/7 覆盖；`extraResources` 以 `?raw` 替代（见开头细化说明）✓
- spec §12 FOUC → Task 1 fallback.css + Task 8 注入顺序 ✓；`webContents.insertCSS` 可选增强未纳入 v1（YAGNI）
- spec §13 安全 → Task 4 `safeThemePath` 路径过滤；CSP 不放开 ✓
- spec §12 热重载（fs.watch）→ 可选增强，未纳入 v1，保留「重新扫描」手动项 ✓
