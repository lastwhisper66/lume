# P5 NodeViews（CodeMirror 代码块 / 表格 / 图片）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 用 NodeView 提升复杂 block 的体验：`code_block` 内嵌 CodeMirror 6（语法高亮 + 真实编辑），`image` 点击编辑 src；表格交互由 P4 已加的 prosemirror-tables 插件提供。

**Architecture:** `code_block` 用一个桥接 NodeView，把内容托管给 CodeMirror；在边界处（首行上箭头 / 末行下箭头 / 起始 Backspace）把控制权交回 ProseMirror，并把 CM 的编辑映射为 PM transaction。`image` 用 NodeView 渲染 `<img>`，点击切换到 `src` 输入框。

**Tech Stack:** CodeMirror 6（@codemirror/state、@codemirror/view、@codemirror/commands、@codemirror/language、@codemirror/language-data）、ProseMirror NodeView。

**验证方式：** 无自动化测试。`npm run typecheck` + `npm run dev` 手动验证代码块高亮/光标进出、图片编辑。

**依赖：** P1、P4 完成（code_block 的 `params` 语言属性、表格插件已就位）。

---

## 文件结构（本阶段涉及）

- Create: `src/renderer/src/components/Editor/nodeviews/codeblock.ts` — CodeMirror NodeView
- Create: `src/renderer/src/components/Editor/nodeviews/image.ts` — 图片 NodeView
- Modify: `src/renderer/src/components/Editor/index.tsx` — 注册 nodeViews
- Modify: `src/renderer/src/components/Editor/Editor.css` — CM 与图片样式

---

## Task 1: 安装 CodeMirror

**Files:** Modify: `package.json`

- [ ] **Step 1: 安装**

```bash
npm install @codemirror/state @codemirror/view @codemirror/commands @codemirror/language @codemirror/language-data
```

Expected: 安装成功。

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 CodeMirror 6"
```

---

## Task 2: CodeMirror 代码块 NodeView

基于 ProseMirror 官方「CodeMirror integration」示例改写：CM 承载代码文本，PM 与 CM 双向同步；边界处交还光标。

**Files:** Create: `src/renderer/src/components/Editor/nodeviews/codeblock.ts`

- [ ] **Step 1: 写 codeblock.ts**

```ts
import { EditorView as CMView, keymap as cmKeymap, drawSelection } from '@codemirror/view'
import { EditorState as CMState, Compartment } from '@codemirror/state'
import { defaultKeymap, indentWithTab } from '@codemirror/commands'
import {
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { TextSelection, Selection } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export class CodeBlockView {
  dom: HTMLElement
  cm: CMView
  private updating = false
  private langCompartment = new Compartment()

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.cm = new CMView({
      doc: this.node.textContent,
      extensions: [
        cmKeymap.of([...this.codeMirrorKeymap(), ...defaultKeymap, indentWithTab]),
        drawSelection(),
        syntaxHighlighting(defaultHighlightStyle),
        this.langCompartment.of([]),
        CMView.updateListener.of((u) => this.forwardUpdate(u))
      ]
    })
    this.dom = this.cm.dom
    this.dom.classList.add('cm-code-block')
    void this.loadLanguage(this.node.attrs.params as string)
  }

  private async loadLanguage(info: string): Promise<void> {
    const name = (info || '').trim().split(/\s+/)[0]
    if (!name) return
    const desc = LanguageDescription.matchLanguageName(languages, name, true)
    if (!desc) return
    const support = await desc.load()
    this.cm.dispatch({ effects: this.langCompartment.reconfigure(support) })
  }

  private forwardUpdate(update): void {
    if (this.updating || !this.cm.hasFocus) return
    const pos = this.getPos()
    if (pos === undefined) return
    let offset = pos + 1
    const { main } = update.state.selection
    const selFrom = offset + main.from
    const selTo = offset + main.to
    const pmSel = this.view.state.selection
    if (update.docChanged || pmSel.from !== selFrom || pmSel.to !== selTo) {
      const tr = this.view.state.tr
      update.changes.iterChanges((fromA: number, toA: number, _fromB: number, _toB: number, text) => {
        if (text.length) tr.replaceWith(offset + fromA, offset + toA, this.view.state.schema.text(text.toString()))
        else tr.delete(offset + fromA, offset + toA)
        offset += (toA - fromA) // 近似修正
      })
      tr.setSelection(TextSelection.create(tr.doc, selFrom, selTo))
      this.view.dispatch(tr)
    }
  }

  private codeMirrorKeymap() {
    const view = this.view
    return [
      { key: 'ArrowUp', run: () => this.maybeEscape('line', -1) },
      { key: 'ArrowLeft', run: () => this.maybeEscape('char', -1) },
      { key: 'ArrowDown', run: () => this.maybeEscape('line', 1) },
      { key: 'ArrowRight', run: () => this.maybeEscape('char', 1) },
      {
        key: 'Backspace',
        run: () => {
          const { state } = this.cm
          if (state.doc.length !== 0) return false
          const pos = this.getPos()
          if (pos === undefined) return true
          const tr = view.state.tr.delete(pos, pos + this.node.nodeSize)
          tr.setSelection(Selection.near(tr.doc.resolve(Math.max(0, pos - 1))))
          view.dispatch(tr)
          view.focus()
          return true
        }
      },
      { key: 'Mod-z', run: () => undo(view.state, view.dispatch) || true },
      { key: 'Mod-y', run: () => redo(view.state, view.dispatch) || true },
      { key: 'Shift-Mod-z', run: () => redo(view.state, view.dispatch) || true },
      {
        key: 'Mod-Enter',
        run: () => {
          if (!exitCode(view.state, view.dispatch)) return false
          view.focus()
          return true
        }
      }
    ]
  }

  private maybeEscape(unit: 'line' | 'char', dir: -1 | 1): boolean {
    const { state } = this.cm
    const { main } = state.selection
    if (!main.empty) return false
    if (unit === 'line') {
      const line = state.doc.lineAt(main.head)
      if (dir < 0 ? line.number !== 1 : line.number !== state.doc.lines) return false
    } else {
      if (dir < 0 ? main.head !== 0 : main.head !== state.doc.length) return false
    }
    const pos = this.getPos()
    if (pos === undefined) return true
    const targetPos = pos + (dir < 0 ? 0 : this.node.nodeSize)
    const selection = Selection.near(this.view.state.doc.resolve(targetPos), dir)
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
    this.view.focus()
    return true
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.updating) return true
    const newText = node.textContent
    const curText = this.cm.state.doc.toString()
    if (newText !== curText) {
      this.updating = true
      this.cm.dispatch({ changes: { from: 0, to: curText.length, insert: newText } })
      this.updating = false
    }
    return true
  }

  setSelection(anchor: number, head: number): void {
    this.cm.focus()
    this.updating = true
    this.cm.dispatch({ selection: { anchor, head } })
    this.updating = false
  }

  selectNode(): void {
    this.cm.focus()
  }

  stopEvent(): boolean {
    return true
  }

  destroy(): void {
    this.cm.destroy()
  }
}
```

> 说明：`forwardUpdate` 的偏移修正是近似实现，适配常见单点编辑；若发现多处同时编辑时同步异常，改为「整块替换」：把 CM 全文一次性 `replaceWith` 到 PM code_block（更稳但撤销粒度粗）。

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS（如报隐式 any，给 `forwardUpdate(update: import('@codemirror/view').ViewUpdate)` 等补类型）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/nodeviews/codeblock.ts
git commit -m "feat: CodeMirror 6 代码块 NodeView"
```

---

## Task 3: 图片 NodeView

**Files:** Create: `src/renderer/src/components/Editor/nodeviews/image.ts`

- [ ] **Step 1: 写 image.ts**

```ts
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export class ImageView {
  dom: HTMLElement
  private img: HTMLImageElement

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'lume-image'

    this.img = document.createElement('img')
    this.img.src = node.attrs.src
    this.img.alt = node.attrs.alt || ''
    if (node.attrs.title) this.img.title = node.attrs.title
    this.dom.appendChild(this.img)

    this.img.addEventListener('click', () => this.enterEdit())
  }

  private enterEdit(): void {
    const input = document.createElement('input')
    input.className = 'lume-image-src'
    input.value = this.node.attrs.src
    const commit = (): void => {
      const pos = this.getPos()
      if (pos === undefined) return
      const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
        ...this.node.attrs,
        src: input.value
      })
      this.view.dispatch(tr)
    }
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        input.blur()
      }
    })
    this.dom.replaceChildren(input)
    input.focus()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.img.src = node.attrs.src
    this.img.alt = node.attrs.alt || ''
    if (!this.dom.contains(this.img)) this.dom.replaceChildren(this.img)
    return true
  }

  stopEvent(e: Event): boolean {
    return e.target instanceof HTMLInputElement
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/nodeviews/image.ts
git commit -m "feat: 图片 NodeView（点击编辑 src）"
```

---

## Task 4: 注册 NodeViews

**Files:** Modify: `src/renderer/src/components/Editor/index.tsx`

- [ ] **Step 1: 在 EditorView 配置里加 nodeViews**

import 区加：

```ts
import { CodeBlockView } from './nodeviews/codeblock'
import { ImageView } from './nodeviews/image'
```

在 `new EditorView(mountRef.current, { state: activeState, ... })` 的配置对象里加：

```ts
      nodeViews: {
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
        image: (node, view, getPos) => new ImageView(node, view, getPos)
      },
```

- [ ] **Step 2: CM 与图片样式**

在 `Editor.css` 追加：

```css
.cm-code-block {
  border: 1px solid #e5e5e5;
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
  font-family: ui-monospace, monospace;
  font-size: 13px;
  padding: 4px 6px;
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: 与语法揭示的协调**

P2 的 code fence 揭示会在 code_block 首尾注入 ```` ``` ```` widget；现在 code_block 由 CodeMirror 接管。为避免重复，修改 `syntaxReveal.ts` 的 `blockDecorations`：删除 `code_block` 分支（CM 已经清晰表达这是代码块，不再需要 widget 围栏）。

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Editor/Editor.css src/renderer/src/components/Editor/syntaxReveal.ts
git commit -m "feat: 注册 code_block/image NodeView 并与揭示协调"
```

---

## Task 5: 手动验证

**Files:** 无（验证）

- [ ] **Step 1: 代码块**

Run: `npm run dev` → 打开含 ```` ```js ```` 代码块的文件。
Expected：

- 代码块显示为 CodeMirror，JS 语法高亮生效。
- 光标在代码块内可正常编辑；在首行按 ↑ / 末行按 ↓ 能跳出到上下文；空代码块按 Backspace 删除整块。
- `Ctrl+S` 保存后，文件里代码块仍是 ```` ``` ```` 围栏且内容正确。

- [ ] **Step 2: 图片**

在文档写 `![alt](https://picsum.photos/200)`。
Expected：渲染出图片；点击图片 → 变为 src 输入框；改地址回车 → 图片更新；保存后 Markdown 为 `![alt](新地址)`。

- [ ] **Step 3: 表格交互（来自 P4 插件）**

在表格内拖拽列边界。
Expected：列宽可调；单元格可选择编辑。

---

## 阶段完成标准

- `npm run typecheck` 通过。
- 代码块为 CodeMirror（高亮 + 边界跳转 + 删除），图片可点击编辑 src，表格可列宽拖拽。
- 各功能保存后 Markdown 往返正确。

---

## 全局收尾（P5 结束后）

- [ ] 全量回归：打开一个真实 Markdown 目录，逐个打开文件，检查渲染/揭示/保存无回归。
- [ ] `npm run build` 通过（类型检查 + 三进程构建）。
- [ ] 参考 superpowers:finishing-a-development-branch 决定合并/PR。
