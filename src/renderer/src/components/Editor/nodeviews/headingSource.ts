import type { Node as PMNode } from 'prosemirror-model'
import { TextSelection } from 'prosemirror-state'
import type { EditorView, NodeView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'

export interface ParsedHeadingSource {
  level: number | null
  text: string
}

export function parseHeadingSource(source: string): ParsedHeadingSource {
  const match = /^(#{1,6})\s+(.*)$/.exec(source)
  if (!match) return { level: null, text: source }
  return { level: match[1].length, text: match[2] }
}

export class HeadingSourceView implements NodeView {
  dom: HTMLElement
  contentDOM: HTMLElement
  private input: HTMLInputElement | null = null

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement(`h${node.attrs.level}`)
    this.contentDOM = document.createElement('span')
    this.dom.appendChild(this.contentDOM)
    this.dom.addEventListener('click', this.startEditing)
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.finishEditing()
    this.node = node
    if (this.dom.tagName !== `H${node.attrs.level}`) return false
    return true
  }

  stopEvent(event: Event): boolean {
    return this.input?.contains(event.target as globalThis.Node) ?? false
  }

  ignoreMutation(): boolean {
    return this.input !== null
  }

  destroy(): void {
    this.finishEditing()
    this.dom.removeEventListener('click', this.startEditing)
  }

  private startEditing = (): void => {
    if (this.input) return
    const input = document.createElement('input')
    input.className = 'heading-source-input'
    input.type = 'text'
    input.value = serialize(this.node.type.schema.node('doc', null, [this.node])).trimEnd()
    input.setAttribute('aria-label', '标题 Markdown 源码')
    input.addEventListener('blur', this.commit)
    input.addEventListener('keydown', this.handleKeyDown)
    this.input = input
    this.contentDOM.hidden = true
    this.dom.appendChild(input)
    input.focus()
    input.setSelectionRange(0, 0)
  }

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      this.cancel()
    } else if (event.key === 'Enter') {
      event.preventDefault()
      this.commit()
      this.view.focus()
    }
  }

  private cancel(): void {
    this.finishEditing()
    this.view.focus()
  }

  private finishEditing(): void {
    if (!this.input) return
    this.input.removeEventListener('blur', this.commit)
    this.input.removeEventListener('keydown', this.handleKeyDown)
    this.input.remove()
    this.input = null
    this.contentDOM.hidden = false
  }

  private commit = (): void => {
    if (!this.input) return
    const source = this.input.value
    this.input.removeEventListener('blur', this.commit)
    const pos = this.getPos()
    if (pos === undefined) return

    const parsedDoc = parse(source)
    const replacement = parsedDoc.firstChild
    if (!replacement) return

    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, replacement)
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
    this.view.dispatch(tr.scrollIntoView())
  }
}
