# Window Title Bar Overlay Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the current Markdown filename from the editor-page header into the Electron window's top title-bar area while preserving native window controls.

**Architecture:** Configure `BrowserWindow` with a hidden title bar and native `titleBarOverlay`, then render the document title inside that overlay region. The renderer no longer allocates a separate grid row for the title; main content receives top padding equal to the overlay height. Renderer-to-main title synchronization uses a narrow preload IPC method, and theme changes update overlay colors in the main process.

**Tech Stack:** Electron BrowserWindow/titleBarOverlay, Electron IPC/preload, React, Zustand, CSS, TypeScript

---

### Task 1: Add window title and overlay IPC support

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

- [ ] Configure `BrowserWindow` with `titleBarStyle: 'hidden'` and a Windows/Linux `titleBarOverlay` using a 38px height, initial background matching the fallback light theme, and a contrasting symbol color.
- [ ] Add a narrow `window:setTitle` IPC endpoint and preload method that accepts a string, normalizes an empty value to `Lume`, and calls the sender window's `setTitle`.
- [ ] Extend the theme-application path so every BrowserWindow receives `setTitleBarOverlay({ color, symbolColor, height: 38 })` derived from the active theme. Use the theme CSS variables or mode metadata already available in `ThemeManager`; do not duplicate theme selection state in the renderer.
- [ ] Run `npm run typecheck:node` and commit with `feat: configure native title bar overlay`.

### Task 2: Place the filename inside the real title-bar overlay

**Files:**
- Modify: `src/renderer/src/components/Navigation/DocumentHeader.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/styles/structure.css`

- [ ] Make `DocumentHeader` display `document?.title ?? 'Lume'` and synchronize the same value through `window.api.window.setTitle` in an effect.
- [ ] Keep `DocumentHeader` as the first top-level child so it paints in the overlay region, but remove the dedicated 38px grid row from `.app-layout`.
- [ ] Position `.document-header` absolutely at `top: 0; left: 0; right: 0; height: 38px`, mark draggable space with `app-region: drag`, and reserve the right-side native window-control safe area. Mark any future interactive descendants `app-region: no-drag`.
- [ ] Give the application content a 38px top inset through layout padding or equivalent positioning so the sidebar and editor begin below the overlay without creating an editor-page navigation row.
- [ ] Center `.document-title` relative to the whole window with absolute `left: 50%` and `transform: translateX(-50%)`; constrain width so it cannot overlap native window controls and retain ellipsis.
- [ ] Run `npm run typecheck:web`, `npm run lint`, and commit with `fix: move document title into window title bar`.

### Task 3: Update documentation and verify integration

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/plans/2026-07-11-single-document-editor.md`

- [ ] Correct current architecture wording so `DocumentHeader` is described as title-bar overlay content, not a page navigation row. Add a short correction note to the original implementation plan rather than rewriting its historical task sequence.
- [ ] Run `npx prettier --check` on changed files, `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.
- [ ] Inspect the runtime CSS and BrowserWindow config for: no dedicated page-header grid row, title relative to the full window, native window buttons retained, and content inset below the overlay.
- [ ] If interactive Electron GUI verification is available, verify dragging, double-click maximize/restore, native minimize/maximize/close buttons, long-title ellipsis, sidebar-visible centering, and light/dark overlay colors. Otherwise report GUI verification as not executed.
- [ ] Commit with `docs: describe window title bar overlay`.
