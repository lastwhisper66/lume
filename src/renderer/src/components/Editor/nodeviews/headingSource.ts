import { closeHistory, redo, undo } from 'prosemirror-history'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'

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
  return Math.min(prefixLength + renderedOffset, sourceLength)
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
  private unsyncedDraft = false

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
    this.rendered.addEventListener('click', this.startEditing)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    this.updateRenderedLevel(node.attrs.level as number)
    if (this.input && !this.dispatchingInput) {
      this.unsyncedDraft = false
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

  destroy(): void {
    this.finishEditing()
    this.rendered.removeEventListener('click', this.startEditing)
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
    oldRendered.removeEventListener('click', this.startEditing)
    rendered.addEventListener('click', this.startEditing)
    this.rendered = rendered
  }

  private serializeNode(node: PMNode): string {
    return serialize(node.type.schema.node('doc', null, [node])).trimEnd()
  }

  private startEditing = (event: MouseEvent): void => {
    if (this.input) return
    const renderedOffset = renderedTextOffsetAtPoint(this.contentDOM, event.clientX, event.clientY)
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
    const offset = sourceCaretOffset(prefixLength, renderedOffset, input.value.length)
    input.setSelectionRange(offset, offset)
    this.resizeInput()
  }

  private handleInput = (): void => {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return
    const parsed = parseSingleBlock(input.value)
    if (parsed?.type !== this.node.type) {
      this.unsyncedDraft = true
      this.resizeInput()
      return
    }
    this.unsyncedDraft = false
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, parsed)
    this.dispatchingInput = true
    try {
      this.view.dispatch(tr)
    } finally {
      this.dispatchingInput = false
    }
    this.resizeInput()
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
      if (this.unsyncedDraft) this.commitInvalidDraft()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      this.splitAtSelection()
    }
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
    if (this.unsyncedDraft && this.commitInvalidDraft()) return
    this.finishEditing()
  }

  private commitInvalidDraft(): boolean {
    const input = this.input
    const pos = this.getPos()
    if (!input || pos === undefined) return false
    const paragraph = paragraphFromSource(this.node.type.schema, input.value)
    const offset = Math.min(input.selectionStart, paragraph.content.size)
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, paragraph)
    tr.setSelection(TextSelection.create(tr.doc, pos + 1 + offset))
    this.unsyncedDraft = false
    this.view.dispatch(tr)
    return true
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
    this.unsyncedDraft = false
    this.rendered.hidden = false
    queueMicrotask(() => {
      this.cleaningUp = false
    })
  }
}
