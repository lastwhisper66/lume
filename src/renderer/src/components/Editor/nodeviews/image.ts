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
      if (input.value === this.node.attrs.src) return
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
