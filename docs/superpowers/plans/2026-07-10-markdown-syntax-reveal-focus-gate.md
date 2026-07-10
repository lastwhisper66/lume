# Markdown 语法揭示焦点门控 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Markdown 语法符号只在 ProseMirror 编辑器真实获得焦点时显示，避免打开文件或切换标签后首行自动呈现编辑态。

**Architecture:** 保留现有 `syntaxReveal` 插件按选区生成 decoration 的逻辑，使用 ProseMirror 自动维护的 `.ProseMirror-focused` 类控制 `.md-marker` 的可见性。焦点门控完全位于 CSS 层，不新增 transaction、插件状态或标签页状态。

**Tech Stack:** Electron、React、ProseMirror、CSS、TypeScript

**Testing exception:** 用户明确要求本次不添加测试代码，由用户手动验证交互；自动验证仅运行类型检查和生产构建。

---

### Task 1: 添加语法标记焦点门控

**Files:**
- Modify: `src/renderer/src/styles/editor.css:46`

- [ ] **Step 1: 在语法标记样式前添加未聚焦隐藏规则**

在 `src/renderer/src/styles/editor.css` 的 `.md-marker` 规则前加入：

```css
.lume-editor .ProseMirror:not(.ProseMirror-focused) .md-marker {
  display: none;
}
```

该选择器只隐藏未聚焦 ProseMirror 内部的语法标记。编辑器获得焦点后 `.ProseMirror-focused` 自动出现，原有 `.md-marker` 和 `.md-marker-block` 样式继续生效。

- [ ] **Step 2: 运行类型检查**

Run: `npm run typecheck`

Expected: `typecheck:node` 和 `typecheck:web` 均退出码为 0。

- [ ] **Step 3: 运行生产构建**

Run: `npm run build`

Expected: TypeScript 检查和 `electron-vite build` 均成功，命令退出码为 0。

- [ ] **Step 4: 交付手动验证清单**

用户在应用中验证：

1. 打开首行为标题的 Markdown 文件，`#` 不显示。
2. 点击标题行，`#` 显示。
3. 点击侧栏、标签栏或其他非编辑区，`#` 隐藏。
4. 切换到另一个首行为 Markdown 语法节点的标签页，未聚焦正文时不显示符号。
5. 再次聚焦正文后，当前选区对应的块级和行内符号正常显示。

- [ ] **Step 5: 提交修复**

```powershell
git add -- src/renderer/src/styles/editor.css
git commit -m "fix: 仅在编辑器聚焦时揭示 Markdown 语法"
```
