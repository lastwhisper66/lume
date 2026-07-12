# Heading Wrap and Live NodeView Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make heading source editing wrap naturally, give Enter normal block-splitting semantics, and keep heading and image URL edits synchronized with ProseMirror before save.

**Architecture:** Keep the existing NodeView approach, but give the heading NodeView a stable wrapper so heading-level changes do not destroy the active editor. Move source splitting into a small exported helper, dispatch ProseMirror transactions on every input, and route undo/redo through ProseMirror history. Give the image NodeView an explicit editing state so live `src` transactions do not replace its input.

**Tech Stack:** TypeScript, ProseMirror NodeView/transactions/history, Vitest with jsdom, CSS.

---

## File map

- Modify `package.json` and `package-lock.json`: add jsdom for DOM-level NodeView tests.
- Modify `src/renderer/src/components/Editor/nodeviews/headingSource.ts`: stable heading wrapper, wrapping textarea, live transactions, Enter splitting, unified undo/redo.
- Modify `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`: pure helper and NodeView integration coverage.
- Modify `src/renderer/src/components/Editor/nodeviews/image.ts`: live URL synchronization while retaining the active input.
- Create `src/renderer/src/components/Editor/nodeviews/image.test.ts`: image NodeView interaction coverage.
- Modify `src/renderer/src/styles/editor.css`: stable wrapper layout and wrapping textarea styles.

### Task 1: Add DOM test coverage for heading source splitting

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`
- Modify: `src/renderer/src/components/Editor/nodeviews/headingSource.ts`

- [ ] **Step 1: Install the DOM test environment**

Run:

```powershell
npm install -D jsdom
```

Expected: `jsdom` is added to `devDependencies`; the lockfile updates without peer dependency errors.

- [ ] **Step 2: Write failing tests for Enter source splitting**

Add the jsdom directive, import `splitHeadingSource`, and append these cases to `headingSource.test.ts`:

```ts
// @vitest-environment jsdom

describe('splitHeadingSource', () => {
  it('splits the heading body at a collapsed caret', () => {
    expect(splitHeadingSource('# BeforeAfter', 8, 8)).toEqual({
      headingSource: '# Before',
      paragraphSource: 'After'
    })
  })

  it('deletes the selected text while splitting', () => {
    expect(splitHeadingSource('## Before middle after', 9, 17)).toEqual({
      headingSource: '## Before',
      paragraphSource: 'after'
    })
  })

  it('does not allow the ATX prefix to move into the paragraph', () => {
    expect(splitHeadingSource('### Title', 0, 0)).toEqual({
      headingSource: '### ',
      paragraphSource: 'Title'
    })
  })

  it('creates an empty paragraph at the end', () => {
    expect(splitHeadingSource('# Title', 7, 7)).toEqual({
      headingSource: '# Title',
      paragraphSource: ''
    })
  })
})
```

Keep the existing `parseHeadingSource` and `sourceCaretOffset` tests in the same file. The import becomes:

```ts
import {
  parseHeadingSource,
  sourceCaretOffset,
  splitHeadingSource
} from './headingSource'
```

- [ ] **Step 3: Run the focused test and verify failure**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
```

Expected: FAIL because `splitHeadingSource` is not exported.

- [ ] **Step 4: Implement the pure splitting helper**

Add this export next to `sourceCaretOffset` in `headingSource.ts`:

```ts
export interface SplitHeadingSource {
  headingSource: string
  paragraphSource: string
}

export function splitHeadingSource(
  source: string,
  selectionStart: number,
  selectionEnd: number
): SplitHeadingSource {
  const parsed = parseHeadingSource(source)
  const prefixLength = parsed.level === null ? 0 : parsed.level + 1
  const bodyStart = Math.min(prefixLength, source.length)
  const from = Math.max(bodyStart, Math.min(selectionStart, source.length))
  const to = Math.max(from, Math.min(selectionEnd, source.length))

  return {
    headingSource: source.slice(0, from),
    paragraphSource: source.slice(to)
  }
}
```

- [ ] **Step 5: Run the focused test and verify success**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
```

Expected: all heading helper tests PASS.

- [ ] **Step 6: Commit the helper and test setup**

```powershell
git add package.json package-lock.json src/renderer/src/components/Editor/nodeviews/headingSource.ts src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
git commit -m "test: cover heading source splitting"
```

### Task 2: Replace the single-line heading input with a live wrapping editor

**Files:**
- Modify: `src/renderer/src/components/Editor/nodeviews/headingSource.ts`
- Modify: `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`
- Modify: `src/renderer/src/styles/editor.css`

- [ ] **Step 1: Write failing NodeView integration tests**

Merge these imports into the top of `headingSource.test.ts`, then append the helpers and tests:

```ts
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { undo } from 'prosemirror-history'
import { buildPlugins } from '../plugins'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import { HeadingSourceView } from './headingSource'

class TestResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver

function createHeadingEditor(markdown: string): { mount: HTMLElement; view: EditorView } {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const state = EditorState.create({ doc: parse(markdown), plugins: buildPlugins() })
  let view!: EditorView
  view = new EditorView(mount, {
    state,
    nodeViews: {
      heading: (node, editorView, getPos) => new HeadingSourceView(node, editorView, getPos)
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  return { mount, view }
}

function openHeadingSource(mount: HTMLElement): HTMLTextAreaElement {
  mount.querySelector<HTMLElement>('.heading-source-rendered')!.click()
  return mount.querySelector<HTMLTextAreaElement>('.heading-source-input')!
}

describe('HeadingSourceView', () => {
  it('uses a wrapping textarea and synchronizes input immediately', () => {
    const { mount, view } = createHeadingEditor('# Old')
    const textarea = openHeadingSource(mount)

    expect(textarea.wrap).toBe('soft')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 72 })
    textarea.value = '# New title'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    expect(serialize(view.state.doc)).toBe('# New title')
    expect(textarea.style.height).toBe('72px')
    expect(mount.querySelector('.heading-source-input')).toBe(textarea)
    view.destroy()
    mount.remove()
  })

  it('keeps the active textarea when the heading level changes', () => {
    const { mount, view } = createHeadingEditor('# Old')
    const textarea = openHeadingSource(mount)
    textarea.value = '## New'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))

    expect(view.state.doc.firstChild?.attrs.level).toBe(2)
    expect(mount.querySelector('.heading-source-input')).toBe(textarea)
    view.destroy()
    mount.remove()
  })

  it('splits the heading into a heading and paragraph on Enter', () => {
    const { mount, view } = createHeadingEditor('# BeforeAfter')
    const textarea = openHeadingSource(mount)
    textarea.setSelectionRange(8, 8)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).type.name).toBe('heading')
    expect(view.state.doc.child(0).textContent).toBe('Before')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).textContent).toBe('After')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    view.destroy()
    mount.remove()
  })

  it('undoes an Enter split as one ProseMirror history event', () => {
    const { mount, view } = createHeadingEditor('# BeforeAfter')
    const textarea = openHeadingSource(mount)
    textarea.setSelectionRange(8, 8)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(undo(view.state, view.dispatch)).toBe(true)
    expect(serialize(view.state.doc)).toBe('# BeforeAfter')
    view.destroy()
    mount.remove()
  })

  it('routes Ctrl+Z from the textarea through ProseMirror history', () => {
    const { mount, view } = createHeadingEditor('# Old')
    const textarea = openHeadingSource(mount)
    textarea.value = '# New'
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })
    )

    expect(serialize(view.state.doc)).toBe('# Old')
    view.destroy()
    mount.remove()
  })

  it('does not give Escape a cancel behavior', () => {
    const { mount, view } = createHeadingEditor('# Title')
    const textarea = openHeadingSource(mount)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))

    expect(mount.querySelector('.heading-source-input')).toBe(textarea)
    view.destroy()
    mount.remove()
  })
})
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
```

Expected: FAIL because the NodeView still creates an `HTMLInputElement`, commits only on blur, and treats Enter/Escape as commit/cancel commands.

- [ ] **Step 3: Add parsing helpers for live input and Enter**

Add these module helpers to `headingSource.ts`:

```ts
function parseSingleBlock(source: string, schema: PMNode['type']['schema']): PMNode {
  return parse(source).firstChild ?? schema.nodes.paragraph.create()
}

function paragraphFromSource(source: string, schema: PMNode['type']['schema']): PMNode {
  if (!source) return schema.nodes.paragraph.create()
  const parsed = parse(`x${source}`).firstChild
  if (!parsed || !parsed.isTextblock) return schema.nodes.paragraph.create(null, schema.text(source))
  return schema.nodes.paragraph.create(null, parsed.content.cut(1))
}
```

The sentinel `x` prevents leading `#`, `-`, `>` or digits in the remainder from becoming a new block type; only inline Markdown parsing is retained in the ordinary paragraph.

- [ ] **Step 4: Refactor `HeadingSourceView` to a stable wrapper and live textarea**

Replace the class implementation while retaining `renderedTextOffsetAtPoint`, `parseHeadingSource`, `sourceCaretOffset`, and `splitHeadingSource`. The resulting class must contain these complete methods and fields:

```ts
export class HeadingSourceView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private rendered: HTMLElement
  private textarea: HTMLTextAreaElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private updatingFromInput = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'heading-source-view'
    this.rendered = document.createElement(`h${node.attrs.level}`)
    this.rendered.className = 'heading-source-rendered'
    this.contentDOM = document.createElement('span')
    this.rendered.appendChild(this.contentDOM)
    this.dom.appendChild(this.rendered)
    this.rendered.addEventListener('click', this.startEditing)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.ensureRenderedLevel(node.attrs.level as number)
    if (this.textarea) {
      const source = this.serializeNode(node)
      if (!this.updatingFromInput && this.textarea.value !== source) this.textarea.value = source
      this.syncTextareaPresentation()
      this.resizeTextarea()
    }
    return true
  }

  stopEvent(event: Event): boolean {
    return this.textarea?.contains(event.target as globalThis.Node) ?? false
  }

  ignoreMutation(): boolean {
    return this.textarea !== null
  }

  destroy(): void {
    this.resizeObserver?.disconnect()
    this.rendered.removeEventListener('click', this.startEditing)
    this.finishEditing()
  }

  private serializeNode(node: PMNode): string {
    return serialize(node.type.schema.node('doc', null, [node])).trimEnd()
  }

  private ensureRenderedLevel(level: number): void {
    if (this.rendered.tagName === `H${level}`) return
    const next = document.createElement(`h${level}`)
    next.className = 'heading-source-rendered'
    next.hidden = this.textarea !== null
    next.appendChild(this.contentDOM)
    next.addEventListener('click', this.startEditing)
    this.rendered.removeEventListener('click', this.startEditing)
    this.rendered.replaceWith(next)
    this.rendered = next
  }

  private startEditing = (event: MouseEvent): void => {
    if (this.textarea) return
    const renderedOffset = renderedTextOffsetAtPoint(
      this.contentDOM,
      event.clientX,
      event.clientY
    )
    const textarea = document.createElement('textarea')
    textarea.className = 'heading-source-input'
    textarea.wrap = 'soft'
    textarea.rows = 1
    textarea.value = this.serializeNode(this.node)
    textarea.setAttribute('aria-label', '标题 Markdown 源码')
    textarea.addEventListener('input', this.handleInput)
    textarea.addEventListener('blur', this.finishEditing)
    textarea.addEventListener('keydown', this.handleKeyDown)
    this.textarea = textarea
    this.syncTextareaPresentation()
    this.rendered.hidden = true
    this.dom.appendChild(textarea)
    this.resizeObserver = new ResizeObserver(this.resizeTextarea)
    this.resizeObserver.observe(this.dom)
    textarea.focus()
    const prefixLength = (this.node.attrs.level as number) + 1
    const offset = sourceCaretOffset(prefixLength, renderedOffset, textarea.value.length)
    textarea.setSelectionRange(offset, offset)
    this.resizeTextarea()
  }

  private handleInput = (): void => {
    if (!this.textarea) return
    const pos = this.getPos()
    if (pos === undefined) return
    const replacement = parseSingleBlock(this.textarea.value, this.node.type.schema)
    this.updatingFromInput = true
    this.view.dispatch(
      this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, replacement)
    )
    this.updatingFromInput = false
    this.resizeTextarea()
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const modifier = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (modifier && key === 'z') {
      event.preventDefault()
      const command = event.shiftKey ? redo : undo
      command(this.view.state, this.view.dispatch)
      return
    }
    if (modifier && key === 'y') {
      event.preventDefault()
      redo(this.view.state, this.view.dispatch)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.splitAtSelection()
    }
  }

  private splitAtSelection(): void {
    if (!this.textarea) return
    const pos = this.getPos()
    if (pos === undefined) return
    const split = splitHeadingSource(
      this.textarea.value,
      this.textarea.selectionStart,
      this.textarea.selectionEnd
    )
    const heading = parseSingleBlock(split.headingSource, this.node.type.schema)
    const paragraph = paragraphFromSource(split.paragraphSource, this.node.type.schema)
    const replacement = Fragment.fromArray([heading, paragraph])
    const transaction = closeHistory(this.view.state.tr.replaceWith(
      pos,
      pos + this.node.nodeSize,
      replacement
    ))
    transaction.setSelection(TextSelection.create(transaction.doc, pos + heading.nodeSize + 1))
    this.finishEditing()
    this.view.dispatch(transaction.scrollIntoView())
    this.view.focus()
  }

  private resizeTextarea = (): void => {
    if (!this.textarea) return
    this.textarea.style.height = '0px'
    this.textarea.style.height = `${this.textarea.scrollHeight}px`
  }

  private syncTextareaPresentation(): void {
    if (!this.textarea) return
    const style = getComputedStyle(this.rendered)
    this.textarea.style.fontSize = style.fontSize
    this.textarea.style.fontWeight = style.fontWeight
    this.textarea.style.lineHeight = style.lineHeight
    this.textarea.style.letterSpacing = style.letterSpacing
    this.textarea.style.marginBlockStart = style.marginBlockStart
    this.textarea.style.marginBlockEnd = style.marginBlockEnd
  }

  private finishEditing = (): void => {
    if (!this.textarea) return
    const textarea = this.textarea
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    textarea.removeEventListener('input', this.handleInput)
    textarea.removeEventListener('blur', this.finishEditing)
    textarea.removeEventListener('keydown', this.handleKeyDown)
    textarea.remove()
    this.textarea = null
    this.rendered.hidden = false
  }
}
```

Update imports to include:

```ts
import { Fragment, type Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import { closeHistory, undo, redo } from 'prosemirror-history'
```

- [ ] **Step 5: Replace the heading input CSS**

Replace `.heading-source-input` and add wrapper rules in `editor.css`:

```css
.heading-source-view {
  display: flow-root;
}

.lume-editor .ProseMirror > .heading-source-view {
  margin-top: 0;
}

.heading-source-input {
  display: block;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  padding: 0;
  border: 0;
  outline: none;
  resize: none;
  overflow-x: hidden;
  overflow-y: hidden;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: transparent;
  color: inherit;
  font: inherit;
  font-family: var(--lume-font-mono);
  line-height: inherit;
}
```

- [ ] **Step 6: Run focused tests and type checking**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
npm run typecheck:web
```

Expected: heading tests PASS and renderer type checking PASS.

- [ ] **Step 7: Commit the heading behavior**

```powershell
git add src/renderer/src/components/Editor/nodeviews/headingSource.ts src/renderer/src/components/Editor/nodeviews/headingSource.test.ts src/renderer/src/styles/editor.css
git commit -m "fix: wrap and live-sync heading source edits"
```

### Task 3: Live-sync image URLs without closing the editor

**Files:**
- Modify: `src/renderer/src/components/Editor/nodeviews/image.ts`
- Create: `src/renderer/src/components/Editor/nodeviews/image.test.ts`

- [ ] **Step 1: Write failing image NodeView tests**

Create `image.test.ts`:

```ts
// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { buildPlugins } from '../plugins'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import { ImageView } from './image'

function createImageEditor(markdown: string): { mount: HTMLElement; view: EditorView } {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const state = EditorState.create({ doc: parse(markdown), plugins: buildPlugins() })
  let view!: EditorView
  view = new EditorView(mount, {
    state,
    nodeViews: {
      image: (node, editorView, getPos) => new ImageView(node, editorView, getPos)
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  return { mount, view }
}

describe('ImageView', () => {
  it('dispatches every URL input and keeps the input active across update', () => {
    const { mount, view } = createImageEditor('![alt](old.png)')
    mount.querySelector<HTMLImageElement>('img')!.click()
    const input = mount.querySelector<HTMLInputElement>('.lume-image-src')!
    input.value = 'new.png'
    input.dispatchEvent(new Event('input', { bubbles: true }))

    expect(serialize(view.state.doc)).toBe('![alt](new.png)')
    expect(mount.querySelector('.lume-image-src')).toBe(input)
    view.destroy()
    mount.remove()
  })

  it('ends the single-line URL edit on Enter', () => {
    const { mount, view } = createImageEditor('![alt](old.png)')
    mount.querySelector<HTMLImageElement>('img')!.click()
    const input = mount.querySelector<HTMLInputElement>('.lume-image-src')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(mount.querySelector('img')).not.toBeNull()
    expect(mount.querySelector('.lume-image-src')).toBeNull()
    view.destroy()
    mount.remove()
  })
})
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/image.test.ts
```

Expected: FAIL because URL changes are only dispatched on blur and `update` replaces the active input.

- [ ] **Step 3: Implement explicit image editing state and live updates**

Replace `ImageView` with this implementation:

```ts
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export class ImageView {
  dom: HTMLElement
  private img: HTMLImageElement
  private input: HTMLInputElement | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'lume-image'
    this.img = document.createElement('img')
    this.img.addEventListener('click', this.enterEdit)
    this.renderImage()
  }

  private renderImage(): void {
    this.img.src = this.node.attrs.src
    this.img.alt = this.node.attrs.alt || ''
    if (this.node.attrs.title) this.img.title = this.node.attrs.title
    else this.img.removeAttribute('title')
    if (!this.dom.contains(this.img)) this.dom.replaceChildren(this.img)
  }

  private enterEdit = (): void => {
    if (this.input) return
    const input = document.createElement('input')
    input.className = 'lume-image-src'
    input.value = this.node.attrs.src
    input.addEventListener('input', this.handleInput)
    input.addEventListener('blur', this.finishEditing)
    input.addEventListener('keydown', this.handleKeyDown)
    this.input = input
    this.dom.replaceChildren(input)
    input.focus()
  }

  private handleInput = (): void => {
    if (!this.input) return
    const pos = this.getPos()
    if (pos === undefined) return
    const transaction = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      src: this.input.value
    })
    this.view.dispatch(transaction)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    this.finishEditing()
    this.view.focus()
  }

  private finishEditing = (): void => {
    if (!this.input) return
    this.input.removeEventListener('input', this.handleInput)
    this.input.removeEventListener('blur', this.finishEditing)
    this.input.removeEventListener('keydown', this.handleKeyDown)
    this.input = null
    this.renderImage()
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.input) {
      if (this.input.value !== node.attrs.src) this.input.value = node.attrs.src
    } else {
      this.renderImage()
    }
    return true
  }

  stopEvent(event: Event): boolean {
    return this.input?.contains(event.target as globalThis.Node) ?? false
  }

  destroy(): void {
    this.img.removeEventListener('click', this.enterEdit)
    this.finishEditing()
  }
}
```

- [ ] **Step 4: Run image tests and renderer type checking**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews/image.test.ts
npm run typecheck:web
```

Expected: image tests PASS and renderer type checking PASS.

- [ ] **Step 5: Commit the image behavior**

```powershell
git add src/renderer/src/components/Editor/nodeviews/image.ts src/renderer/src/components/Editor/nodeviews/image.test.ts
git commit -m "fix: live-sync image URL edits"
```

### Task 4: Verify save-visible state and editor regressions

**Files:**
- Modify only if verification exposes a defect in the files listed above.

- [ ] **Step 1: Run all NodeView tests together**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/nodeviews
```

Expected: heading and image NodeView tests PASS.

- [ ] **Step 2: Run the complete automated suite**

Run:

```powershell
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run static verification**

Run:

```powershell
npm run typecheck
npm run lint
```

Expected: both commands PASS with no new warnings.

- [ ] **Step 4: Build the Electron application**

Run:

```powershell
npm run build
```

Expected: main, preload, and renderer builds complete successfully.

- [ ] **Step 5: Perform the focused manual checks**

Run:

```powershell
npm run dev
```

Verify:

1. Open a Markdown file containing a long H1 and narrow the window until it wraps.
2. Click the title; the source textarea wraps to the same content width without a horizontal scrollbar.
3. Type without leaving the title, press `Ctrl+S`, reopen the file, and confirm the latest title text was saved.
4. Put the caret in the middle of the title and press Enter; the suffix becomes a normal paragraph and the caret enters it.
5. Press `Ctrl+Z` once; the original title is restored.
6. Press Escape while editing a title; the edit remains active and content is unchanged.
7. Edit an image URL, press `Ctrl+S` before leaving the field, reopen the file, and confirm the latest URL was saved.
8. Confirm ordinary paragraphs, lists, blockquotes, and CodeMirror code blocks retain their existing Enter behavior.

- [ ] **Step 6: Review repository cleanliness and final diff**

Run:

```powershell
git diff --check
git status --short
git log -4 --oneline
```

Expected: no whitespace errors; only intentional implementation files remain changed; the task commits are visible in recent history.
