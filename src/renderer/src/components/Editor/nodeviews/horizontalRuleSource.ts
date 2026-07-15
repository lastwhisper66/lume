import { redo, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import { NodeSelection, Plugin, Selection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { registerTransientEditFlush } from '../transientEdits'

// A horizontal_rule has no attributes, so its Markdown source is always the
// normalized `---`. Revealing it just lets the user turn the divider into
// something else (or leave it as a divider).
const HR_SOURCE = '---'

const registry = new WeakMap<HTMLElement, HorizontalRuleView>()

/**
 * Reveals a horizontal_rule's Markdown source whenever the cursor lands on it
 * (which always produces a NodeSelection), regardless of whether the selection
 * change came from keyboard navigation or a mouse click.
 */
export function horizontalRuleRevealPlugin(): Plugin {
  return new Plugin({
    view() {
      return {
        update(view, prevState) {
          const { selection } = view.state
          if (prevState.selection.eq(selection) && prevState.doc.eq(view.state.doc)) return
          if (!view.hasFocus()) return
          if (!(selection instanceof NodeSelection)) return
          if (selection.node.type.name !== 'horizontal_rule') return
          const dom = view.nodeDOM(selection.from)
          if (!(dom instanceof HTMLElement)) return
          // Entered from above (previous selection sits before the rule) → caret
          // at the start of "---"; entered from below → caret at the end.
          const caretAtStart = prevState.selection.from < selection.from
          registry.get(dom)?.reveal(caretAtStart)
        }
      }
    }
  })
}

/** True when `source` parses to a single horizontal rule (`---`, `***`, `___`, …). */
export function isHorizontalRuleSource(source: string): boolean {
  const doc = parse(source)
  return doc.childCount === 1 && doc.firstChild?.type.name === 'horizontal_rule'
}

/** Parse a Markdown source into its top-level blocks, defaulting to an empty paragraph. */
export function parseSourceBlocks(source: string): PMNode[] {
  const doc = parse(source)
  const blocks: PMNode[] = []
  doc.forEach((child) => blocks.push(child))
  if (blocks.length === 0) blocks.push(doc.type.schema.nodes.paragraph.create())
  return blocks
}

export class HorizontalRuleView implements NodeView {
  dom: HTMLElement
  private rendered: HTMLHRElement
  private input: HTMLInputElement | null = null
  private unregisterTransientFlush: (() => void) | null = null
  private cleaningUp = false
  private openScheduled = false
  private pendingCaretAtStart = false
  private destroyed = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'hr-source-wrapper'
    this.rendered = document.createElement('hr')
    this.rendered.className = 'hr-source-rendered'
    this.dom.appendChild(this.rendered)
    this.dom.addEventListener('mousedown', this.handleMouseDown)
    registry.set(this.dom, this)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    return true
  }

  stopEvent(event: Event): boolean {
    return this.input?.contains(event.target as globalThis.Node) ?? false
  }

  ignoreMutation(): boolean {
    return true
  }

  destroy(): void {
    this.destroyed = true
    this.finishEditing()
    this.dom.removeEventListener('mousedown', this.handleMouseDown)
    registry.delete(this.dom)
  }

  /** Called by the reveal plugin when a NodeSelection lands on this rule. */
  reveal(caretAtStart: boolean): void {
    if (this.input || this.cleaningUp || this.destroyed || this.openScheduled) return
    this.openScheduled = true
    this.pendingCaretAtStart = caretAtStart
    queueMicrotask(() => {
      this.openScheduled = false
      if (this.input || this.cleaningUp || this.destroyed || !this.selectionOnThisNode()) return
      this.startEditing(this.pendingCaretAtStart)
    })
  }

  private selectionOnThisNode(): boolean {
    const pos = this.getPos()
    if (pos === undefined) return false
    const selection = this.view.state.selection
    return selection instanceof NodeSelection && selection.from === pos
  }

  private handleMouseDown = (event: MouseEvent): void => {
    if (this.input || event.button !== 0) return
    // Take over the click so ProseMirror doesn't fight us over focus/selection.
    event.preventDefault()
    this.startEditing()
  }

  private startEditing(caretAtStart = false): void {
    if (this.input || this.destroyed) return
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'hr-source-input'
    input.value = HR_SOURCE
    input.setAttribute('aria-label', '分隔线 Markdown 源码')
    input.addEventListener('blur', this.handleBlur)
    input.addEventListener('keydown', this.handleKeyDown)
    this.input = input
    this.unregisterTransientFlush = registerTransientEditFlush(this.flushTransientDraft)
    this.rendered.hidden = true
    this.dom.appendChild(input)
    input.focus()
    const caret = caretAtStart ? 0 : input.value.length
    input.setSelectionRange(caret, caret)
  }

  private handleBlur = (): void => {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) {
      this.finishEditing()
      return
    }
    if (isHorizontalRuleSource(input.value)) {
      this.finishEditing()
      return
    }
    this.convertToBlocks(input.value, pos, false)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    const modifier = event.ctrlKey || event.metaKey
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      const command = event.shiftKey ? redo : undo
      command(this.view.state, this.view.dispatch)
      return
    }
    if (modifier && event.key.toLowerCase() === 'y') {
      event.preventDefault()
      redo(this.view.state, this.view.dispatch)
      return
    }
    if (modifier && event.key.toLowerCase() === 's') {
      this.flushTransientDraft()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.commit('after')
      return
    }
    if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight' ||
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown'
    ) {
      this.handleArrowNavigation(event)
    }
  }

  private handleArrowNavigation(event: KeyboardEvent): void {
    const input = this.input
    if (!input) return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    if (input.selectionStart !== input.selectionEnd) return
    const atStart = input.selectionStart === 0
    const atEnd = input.selectionEnd === input.value.length
    let direction: 'before' | 'after' | null = null
    switch (event.key) {
      case 'ArrowLeft':
        direction = atStart ? 'before' : null
        break
      case 'ArrowUp':
        direction = 'before'
        break
      case 'ArrowRight':
        direction = atEnd ? 'after' : null
        break
      case 'ArrowDown':
        direction = 'after'
        break
    }
    if (!direction) return
    event.preventDefault()
    this.commit(direction)
  }

  /** Leave edit mode, moving the selection out to `exit` when the source is still a rule. */
  private commit(exit: 'before' | 'after'): void {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    if (isHorizontalRuleSource(input.value)) {
      this.finishEditing()
      this.moveSelectionOut(pos, exit)
      return
    }
    this.convertToBlocks(input.value, pos, true)
  }

  private moveSelectionOut(pos: number, exit: 'before' | 'after'): void {
    const nodeEnd = pos + this.node.nodeSize
    const boundary = exit === 'before' ? pos : nodeEnd
    const bias = exit === 'before' ? -1 : 1
    const selection = Selection.near(this.view.state.doc.resolve(boundary), bias)
    // Focus before dispatching so selection-driven reveal plugins (e.g. the
    // heading source reveal, which bails when the view is unfocused) see focus
    // while their update hook runs.
    this.view.focus()
    this.view.dispatch(this.view.state.tr.setSelection(selection).scrollIntoView())
  }

  private convertToBlocks(source: string, pos: number, focus: boolean): void {
    const blocks = parseSourceBlocks(source)
    const nodeEnd = pos + this.node.nodeSize
    const tr = this.view.state.tr.replaceWith(pos, nodeEnd, blocks)
    const caret = Selection.near(tr.doc.resolve(tr.mapping.map(nodeEnd)), -1)
    tr.setSelection(caret).scrollIntoView()
    // Dispatching swaps this node's type, which destroys this NodeView (and
    // tears down the input via destroy → finishEditing).
    this.view.dispatch(tr)
    if (focus) this.view.focus()
  }

  private flushTransientDraft = (): void => {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    if (isHorizontalRuleSource(input.value)) return
    this.convertToBlocks(input.value, pos, false)
  }

  private finishEditing(): void {
    const input = this.input
    if (!input) return
    this.cleaningUp = true
    this.unregisterTransientFlush?.()
    this.unregisterTransientFlush = null
    input.removeEventListener('blur', this.handleBlur)
    input.removeEventListener('keydown', this.handleKeyDown)
    input.remove()
    this.input = null
    this.rendered.hidden = false
    queueMicrotask(() => {
      this.cleaningUp = false
    })
  }
}
