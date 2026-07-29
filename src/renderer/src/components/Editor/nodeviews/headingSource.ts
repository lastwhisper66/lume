import { closeHistory, redo, undo } from 'prosemirror-history'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { Plugin, Selection, TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'

const headingViewRegistry = new WeakMap<HTMLElement, HeadingSourceView>()

// Reveals a heading's Markdown source whenever the cursor lands inside it, no
// matter whether the selection change came from a transaction or from native
// arrow-key navigation (which never calls NodeView.setSelection).
export function headingRevealPlugin(): Plugin {
  return new Plugin({
    view() {
      return {
        update(view, prevState) {
          const { selection } = view.state
          if (prevState.selection.eq(selection) && prevState.doc.eq(view.state.doc)) return
          if (!view.hasFocus()) return
          if (!(selection instanceof TextSelection)) return
          const $head = selection.$head
          if ($head.parent.type.name !== 'heading') return
          if (selection.$anchor.parent !== $head.parent) return
          const headingDom = view.nodeDOM($head.before($head.depth))
          if (!(headingDom instanceof HTMLElement)) return
          headingViewRegistry
            .get(headingDom)
            ?.revealForSelection(selection.$anchor.parentOffset, $head.parentOffset)
        }
      }
    }
  })
}

export interface ParsedHeadingSource {
  level: number | null
  text: string
}

export interface SplitHeadingSource {
  headingSource: string
  paragraphSource: string
}

export function parseHeadingSource(source: string): ParsedHeadingSource {
  const match = /^(#{1,6})\s+(.*)$/.exec(source)
  if (!match) return { level: null, text: source }
  return { level: match[1].length, text: match[2] }
}

export function splitHeadingSource(
  source: string,
  selectionStart: number,
  selectionEnd: number
): SplitHeadingSource {
  const parsed = parseHeadingSource(source)
  const prefixLength = parsed.level === null ? 0 : source.length - parsed.text.length
  const bodyStart = Math.min(prefixLength, source.length)
  const selectionFrom = Math.min(selectionStart, selectionEnd)
  const selectionTo = Math.max(selectionStart, selectionEnd)
  const from = Math.max(bodyStart, Math.min(selectionFrom, source.length))
  const to = Math.max(from, Math.min(selectionTo, source.length))
  return { headingSource: source.slice(0, from), paragraphSource: source.slice(to) }
}

export function sourceCaretOffset(
  prefixLength: number,
  renderedOffset: number,
  sourceLength: number
): number {
  if (renderedOffset <= 0) return 0
  return Math.min(prefixLength + renderedOffset, sourceLength)
}

export interface ArrowNavigationState {
  key: string
  collapsed: boolean
  atStart: boolean
  atEnd: boolean
  firstRow: boolean
  lastRow: boolean
}

export function resolveArrowNavigation(state: ArrowNavigationState): 'before' | 'after' | null {
  if (!state.collapsed) return null
  switch (state.key) {
    case 'ArrowLeft':
      return state.atStart ? 'before' : null
    case 'ArrowRight':
      return state.atEnd ? 'after' : null
    case 'ArrowUp':
      return state.firstRow ? 'before' : null
    case 'ArrowDown':
      return state.lastRow ? 'after' : null
    default:
      return null
  }
}

function renderedTextOffsetAtPoint(root: HTMLElement, x: number, y: number): number {
  const documentWithFallback = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const caretPosition = document.caretPositionFromPoint?.(x, y)
  const caretRange = caretPosition ? null : documentWithFallback.caretRangeFromPoint?.(x, y)
  const node = caretPosition?.offsetNode ?? caretRange?.startContainer
  const offset = caretPosition?.offset ?? caretRange?.startOffset
  if (!node || offset === undefined || !root.contains(node)) return root.textContent?.length ?? 0

  const range = document.createRange()
  range.setStart(root, 0)
  range.setEnd(node, offset)
  return range.toString().length
}

function caretRowInfo(textarea: HTMLTextAreaElement): { firstRow: boolean; lastRow: boolean } {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  const copyProps = [
    'boxSizing',
    'paddingTop',
    'paddingRight',
    'paddingBottom',
    'paddingLeft',
    'borderTopWidth',
    'borderRightWidth',
    'borderBottomWidth',
    'borderLeftWidth',
    'fontFamily',
    'fontSize',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
    'textTransform',
    'textIndent',
    'wordBreak',
    'tabSize'
  ] as const
  for (const prop of copyProps) {
    mirror.style[prop] = style[prop]
  }
  mirror.style.position = 'absolute'
  mirror.style.top = '0'
  mirror.style.left = '-9999px'
  mirror.style.visibility = 'hidden'
  mirror.style.height = 'auto'
  mirror.style.width = `${textarea.clientWidth}px`
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.overflowWrap = 'anywhere'

  const { value, selectionStart } = textarea
  mirror.appendChild(document.createTextNode(value.slice(0, selectionStart)))
  const marker = document.createElement('span')
  mirror.appendChild(marker)
  mirror.appendChild(document.createTextNode(value.slice(selectionStart)))
  document.body.appendChild(mirror)

  const parsedLineHeight = parseFloat(style.lineHeight)
  const lineHeight =
    Number.isFinite(parsedLineHeight) && parsedLineHeight > 0
      ? parsedLineHeight
      : marker.offsetHeight || 1
  const caretRow = Math.round(marker.offsetTop / lineHeight)
  const totalRows = Math.max(1, Math.round(mirror.scrollHeight / lineHeight))
  document.body.removeChild(mirror)

  return { firstRow: caretRow <= 0, lastRow: caretRow >= totalRows - 1 }
}

function parseSingleBlock(source: string): PMNode | null {
  const parsedDoc = parse(source)
  return parsedDoc.childCount === 1 ? parsedDoc.firstChild : null
}

function paragraphFromSource(schema: Schema, source: string): PMNode {
  return schema.nodes.paragraph.create(null, source ? schema.text(source) : undefined)
}

export class HeadingSourceView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private rendered: HTMLHeadingElement
  private input: HTMLTextAreaElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private cleaningUp = false
  private dispatchingInput = false
  private pendingSelection: { from: number; to: number } | null = null
  private openScheduled = false
  private destroyed = false

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('div')
    this.dom.className = 'heading-source-wrapper'
    this.contentDOM = document.createElement('span')
    this.rendered = this.createRenderedHeading(node.attrs.level as number)
    this.rendered.appendChild(this.contentDOM)
    this.dom.appendChild(this.rendered)
    this.rendered.addEventListener('click', this.handleRenderedClick)
    headingViewRegistry.set(this.dom, this)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.updateRenderedLevel(node.attrs.level as number)
    if (this.input && !this.dispatchingInput) {
      const value = this.serializeNode(node)
      if (this.input.value !== value) {
        const selectionStart = Math.min(this.input.selectionStart, value.length)
        const selectionEnd = Math.min(this.input.selectionEnd, value.length)
        this.input.value = value
        this.input.setSelectionRange(selectionStart, selectionEnd)
      }
    }
    this.applyHeadingPresentation()
    this.resizeInput()
    return true
  }

  stopEvent(event: Event): boolean {
    return this.input?.contains(event.target as globalThis.Node) ?? false
  }

  ignoreMutation(): boolean {
    return this.input !== null || this.cleaningUp
  }

  revealForSelection(anchorOffset: number, headOffset: number): void {
    if (this.input || this.cleaningUp || this.destroyed) return
    this.pendingSelection = {
      from: Math.min(anchorOffset, headOffset),
      to: Math.max(anchorOffset, headOffset)
    }
    if (this.openScheduled) return
    this.openScheduled = true
    queueMicrotask(() => {
      this.openScheduled = false
      const pending = this.pendingSelection
      this.pendingSelection = null
      if (
        !pending ||
        this.input ||
        this.cleaningUp ||
        this.destroyed ||
        !this.selectionInsideHeading()
      ) {
        return
      }
      this.startEditing(pending.from, pending.to)
    })
  }

  private selectionInsideHeading(): boolean {
    const pos = this.getPos()
    if (pos === undefined) return false
    const head = this.view.state.selection.$head.pos
    return head > pos && head < pos + this.node.nodeSize
  }

  destroy(): void {
    this.destroyed = true
    this.finishEditing()
    this.rendered.removeEventListener('click', this.handleRenderedClick)
    headingViewRegistry.delete(this.dom)
  }

  private createRenderedHeading(level: number): HTMLHeadingElement {
    const rendered = document.createElement(`h${level}`) as HTMLHeadingElement
    rendered.className = 'heading-source-rendered'
    return rendered
  }

  private updateRenderedLevel(level: number): void {
    if (this.rendered.tagName === `H${level}`) return
    const oldRendered = this.rendered
    const rendered = this.createRenderedHeading(level)
    rendered.hidden = oldRendered.hidden
    rendered.appendChild(this.contentDOM)
    oldRendered.replaceWith(rendered)
    oldRendered.removeEventListener('click', this.handleRenderedClick)
    rendered.addEventListener('click', this.handleRenderedClick)
    this.rendered = rendered
  }

  private serializeNode(node: PMNode): string {
    return serialize(node.type.schema.node('doc', null, [node])).trimEnd()
  }

  private handleRenderedClick = (event: MouseEvent): void => {
    if (this.input) return
    const renderedOffset = renderedTextOffsetAtPoint(this.contentDOM, event.clientX, event.clientY)
    this.startEditing(renderedOffset, renderedOffset)
  }

  private startEditing(fromRenderedOffset: number, toRenderedOffset: number): void {
    if (this.input) return
    const input = document.createElement('textarea')
    input.className = 'heading-source-input'
    input.value = this.serializeNode(this.node)
    input.wrap = 'soft'
    input.rows = 1
    input.setAttribute('aria-label', '标题 Markdown 源码')
    input.addEventListener('blur', this.handleBlur)
    input.addEventListener('input', this.handleInput)
    input.addEventListener('keydown', this.handleKeyDown)
    this.input = input
    this.applyHeadingPresentation()
    this.rendered.hidden = true
    this.dom.appendChild(input)
    this.resizeObserver = new ResizeObserver(this.resizeInput)
    this.resizeObserver.observe(input)
    input.focus()
    const prefixLength = (this.node.attrs.level as number) + 1
    const from = sourceCaretOffset(prefixLength, fromRenderedOffset, input.value.length)
    const to = sourceCaretOffset(prefixLength, toRenderedOffset, input.value.length)
    input.setSelectionRange(Math.min(from, to), Math.max(from, to))
    this.resizeInput()
  }

  private handleInput = (): void => {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    const parsed = parseSingleBlock(input.value)
    if (parsed?.type !== this.node.type) {
      // Source is no longer a valid heading (e.g. the space after the # markers
      // was removed): convert to a paragraph immediately so it renders as body
      // text in place, instead of holding a draft until the caret leaves.
      this.convertToParagraph()
      return
    }
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, parsed)
    this.dispatchingInput = true
    try {
      this.view.dispatch(tr)
    } finally {
      this.dispatchingInput = false
    }
    this.resizeInput()
  }

  private convertToParagraph(): void {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    const paragraph = paragraphFromSource(this.node.type.schema, input.value)
    const offset = Math.min(input.selectionStart, paragraph.content.size)
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, paragraph)
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + offset))
    this.view.dispatch(tr)
    this.view.focus()
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
    if (event.key === 'Enter') {
      event.preventDefault()
      this.splitAtSelection()
      return
    }
    if (
      event.key === 'ArrowUp' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowRight'
    ) {
      this.handleArrowNavigation(event)
    }
  }

  private handleArrowNavigation(event: KeyboardEvent): void {
    const input = this.input
    if (!input) return
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    let firstRow = true
    let lastRow = true
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const info = caretRowInfo(input)
      firstRow = info.firstRow
      lastRow = info.lastRow
    }
    const direction = resolveArrowNavigation({
      key: event.key,
      collapsed: input.selectionStart === input.selectionEnd,
      atStart: input.selectionStart === 0,
      atEnd: input.selectionEnd === input.value.length,
      firstRow,
      lastRow
    })
    if (!direction) return
    event.preventDefault()
    this.moveSelectionToAdjacentBlock(direction)
  }

  private moveSelectionToAdjacentBlock(direction: 'before' | 'after'): void {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    const { state } = this.view
    const nodeEnd = pos + this.node.nodeSize
    const boundary = direction === 'before' ? pos : nodeEnd
    const selection = Selection.near(state.doc.resolve(boundary), direction === 'before' ? -1 : 1)
    // No block in that direction: keep editing and move the caret to the source
    // edge instead of dispatching (which would flicker back into this heading).
    if (selection.from >= pos && selection.to <= nodeEnd) {
      const caret = direction === 'before' ? 0 : input.value.length
      input.setSelectionRange(caret, caret)
      return
    }
    const tr = state.tr.setSelection(selection).scrollIntoView()
    this.finishEditing()
    this.view.focus()
    this.view.dispatch(tr)
  }

  private splitAtSelection(): void {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    const { headingSource, paragraphSource } = splitHeadingSource(
      input.value,
      input.selectionStart,
      input.selectionEnd
    )
    const parsedHeading = parseSingleBlock(headingSource)
    const parsedSource = parseHeadingSource(headingSource)
    const heading =
      parsedHeading?.type === this.node.type
        ? parsedHeading
        : this.node.type.create(
            { level: parsedSource.level ?? this.node.attrs.level },
            parsedSource.text ? this.node.type.schema.text(parsedSource.text) : undefined
          )
    const paragraph = paragraphFromSource(this.node.type.schema, paragraphSource)
    const paragraphPos = pos + heading.nodeSize
    let tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, [heading, paragraph])
    tr = closeHistory(tr)
    tr.setSelection(TextSelection.create(tr.doc, paragraphPos + 1))
    this.finishEditing()
    this.view.dispatch(tr)
    this.view.focus()
  }

  private handleBlur = (): void => {
    this.finishEditing()
  }

  private applyHeadingPresentation(): void {
    if (!this.input) return
    const style = getComputedStyle(this.rendered)
    this.input.style.fontSize = style.fontSize
    this.input.style.fontWeight = style.fontWeight
    this.input.style.lineHeight = style.lineHeight
    this.input.style.letterSpacing = style.letterSpacing
    this.input.style.marginTop = style.marginTop
    this.input.style.marginBottom = style.marginBottom
  }

  private resizeInput = (): void => {
    if (!this.input) return
    this.input.style.height = 'auto'
    this.input.style.height = `${this.input.scrollHeight}px`
  }

  private finishEditing = (): void => {
    if (!this.input) return
    this.cleaningUp = true
    const input = this.input
    input.removeEventListener('blur', this.handleBlur)
    input.removeEventListener('input', this.handleInput)
    input.removeEventListener('keydown', this.handleKeyDown)
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    input.remove()
    this.input = null
    this.rendered.hidden = false
    queueMicrotask(() => {
      this.cleaningUp = false
    })
  }
}
