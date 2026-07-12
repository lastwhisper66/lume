import { redo, undo } from 'prosemirror-history'
import type { Node as PMNode } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'

export class ImageView {
  dom: HTMLElement
  private img: HTMLImageElement
  private input: HTMLInputElement | null = null
  private destroyed = false

  private readonly handleImageClick = (): void => this.enterEdit()

  private readonly handleInput = (): void => {
    const input = this.input
    if (!input) return
    const pos = this.getPos()
    if (pos === undefined) return
    const tr = this.view.state.tr.setNodeMarkup(pos, undefined, {
      ...this.node.attrs,
      src: input.value
    })
    this.view.dispatch(tr)
  }

  private readonly handleBlur = (): void => this.exitEdit()

  private readonly handleKeydown = (event: KeyboardEvent): void => {
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
      this.exitEdit()
      this.view.focus()
    }
  }

  constructor(
    private node: PMNode,
    private view: EditorView,
    private getPos: () => number | undefined
  ) {
    this.dom = document.createElement('span')
    this.dom.className = 'lume-image'

    this.img = document.createElement('img')
    this.renderImageAttrs()
    this.dom.appendChild(this.img)

    this.img.addEventListener('click', this.handleImageClick)
  }

  private enterEdit(): void {
    if (this.input || this.destroyed) return
    const input = document.createElement('input')
    input.className = 'lume-image-src'
    input.value = this.node.attrs.src
    input.addEventListener('input', this.handleInput)
    input.addEventListener('blur', this.handleBlur)
    input.addEventListener('keydown', this.handleKeydown)
    this.input = input
    this.dom.replaceChildren(input)
    input.focus()
  }

  private exitEdit(): void {
    const input = this.input
    if (!input) return
    this.removeInputListeners(input)
    this.input = null
    if (this.destroyed) return
    this.renderImageAttrs()
    this.dom.replaceChildren(this.img)
  }

  private removeInputListeners(input: HTMLInputElement): void {
    input.removeEventListener('input', this.handleInput)
    input.removeEventListener('blur', this.handleBlur)
    input.removeEventListener('keydown', this.handleKeydown)
  }

  private renderImageAttrs(): void {
    this.img.src = this.node.attrs.src
    this.img.alt = this.node.attrs.alt || ''
    if (this.node.attrs.title) {
      this.img.title = this.node.attrs.title
    } else {
      this.img.removeAttribute('title')
    }
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false
    this.node = node
    if (this.destroyed) return true
    if (this.input) {
      if (this.input.value !== node.attrs.src) this.input.value = node.attrs.src
      return true
    }
    this.renderImageAttrs()
    if (!this.dom.contains(this.img)) this.dom.replaceChildren(this.img)
    return true
  }

  stopEvent(e: Event): boolean {
    return this.input !== null && e.target === this.input
  }

  destroy(): void {
    this.destroyed = true
    this.img.removeEventListener('click', this.handleImageClick)
    if (this.input) {
      this.removeInputListeners(this.input)
      this.input = null
    }
  }
}
