# Heading Source Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a rendered heading to become editable ATX Markdown source on click and return to rendered form when focus leaves it.

**Architecture:** Add a focused heading NodeView that owns the temporary source input and commits through a ProseMirror transaction. Keep parsing logic in a small pure helper so heading levels and paragraph fallback can be tested without a browser DOM; remove the old heading marker decoration and boundary keyboard workaround.

**Tech Stack:** TypeScript, ProseMirror NodeView/transactions, Vitest, CSS.

---

### Task 1: Parse editable heading source

**Files:**
- Create: `src/renderer/src/components/Editor/nodeviews/headingSource.ts`
- Create: `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`

- [ ] **Step 1: Write failing parser tests**

Test `parseHeadingSource` for `### Title`, `Title`, `####### Title`, empty text, and preservation of inline `#` characters. Expected results are `{ level: 3, text: 'Title' }` for valid ATX syntax and `{ level: null, text: source }` otherwise.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`
Expected: FAIL because `headingSource` does not exist.

- [ ] **Step 3: Implement the pure parser**

Export `parseHeadingSource(source: string): { level: number | null; text: string }`. Match only `^(#{1,6})\\s+(.*)$`; return the marker length and captured text on success, otherwise return a paragraph result containing the original source.

- [ ] **Step 4: Run the focused test and verify success**

Run: `npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`
Expected: PASS.

### Task 2: Add the heading NodeView

**Files:**
- Modify: `src/renderer/src/components/Editor/nodeviews/headingSource.ts`
- Modify: `src/renderer/src/components/Editor/plugins.ts`
- Modify: `src/renderer/src/styles/editor.css`

- [ ] **Step 1: Implement rendered and source-editing states**

Add `HeadingSourceView` implementing ProseMirror's `NodeView`. Its DOM starts as the matching `h1`–`h6` with a `contentDOM`. On click, replace the rendered content with a single-line text input containing `${'#'.repeat(level)} ${textContent}`, focus it, and place the caret based on the click or at the nearest source position.

- [ ] **Step 2: Commit edits through a transaction**

On input blur, call `parseHeadingSource`, create either `schema.nodes.heading` with the parsed level or `schema.nodes.paragraph`, and replace the current node using `view.dispatch(view.state.tr.replaceWith(getPos(), getPos() + node.nodeSize, replacement))`. Preserve plain text and return focus to the editor without swallowing the click target.

- [ ] **Step 3: Add keyboard behavior**

On `Escape`, discard the input and restore the rendered NodeView. On `Enter`, prevent a newline, commit the source, then place a text selection in the resulting block. Stop ProseMirror from handling input events originating inside the temporary editor.

- [ ] **Step 4: Register and style the NodeView**

Register `heading: (node, view, getPos) => new HeadingSourceView(node, view, getPos)` through an EditorView `nodeViews` prop plugin. Style `.heading-source-input` to inherit heading font size, weight, line height, width, foreground, and background while using the monospace font for visible Markdown markers.

- [ ] **Step 5: Run type checking**

Run: `npm run typecheck:web`
Expected: PASS.

### Task 3: Remove the conflicting marker behavior

**Files:**
- Modify: `src/renderer/src/components/Editor/syntaxReveal.ts`
- Modify: `src/renderer/src/components/Editor/syntaxReveal.test.ts`
- Modify: `src/renderer/src/components/Editor/commands.ts`
- Modify: `src/renderer/src/components/Editor/headingCommands.test.ts`

- [ ] **Step 1: Remove heading decorations**

Delete `headingMarkerKey` and the heading branch in `blockDecorations`; keep blockquote and inline reveal behavior intact. Replace the marker-key test with coverage for any remaining exported pure behavior, or delete it when it no longer tests a public contract.

- [ ] **Step 2: Remove obsolete caret interception**

Delete `lowerHeadingLevel`, `keepHeadingCaretAtStart`, and their `Backspace`/`ArrowLeft` key bindings. Delete the tests that encoded the old non-editable-marker interaction.

- [ ] **Step 3: Run editor tests**

Run: `npm test -- src/renderer/src/components/Editor`
Expected: PASS.

### Task 4: Full verification

**Files:**
- Modify only if verification exposes an issue in the files above.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm test`
Expected: all tests PASS.

- [ ] **Step 2: Run static verification**

Run: `npm run typecheck && npm run lint`
Expected: both commands PASS.

- [ ] **Step 3: Build the application**

Run: `npm run build`
Expected: Electron renderer and main process build successfully.

- [ ] **Step 4: Review the final diff**

Run: `git diff --check` and `git diff --stat`
Expected: no whitespace errors; changes remain limited to the heading source interaction, its tests, styles, and documentation.
