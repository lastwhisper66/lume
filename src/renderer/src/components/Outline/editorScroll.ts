import type { EditorView } from 'prosemirror-view'

let currentEditorView: EditorView | null = null

const headingSelector = 'h1, h2, h3, h4, h5, h6'
const blockSelector = `${headingSelector}, p, blockquote, pre, li, table, hr`

export function registerEditorView(view: EditorView): () => void {
  currentEditorView = view

  return () => {
    if (currentEditorView === view) currentEditorView = null
  }
}

function elementForNode(node: Node | null): HTMLElement | null {
  if (!node) return null
  if (node instanceof HTMLElement) return node
  return node.parentElement
}

function blockForNode(node: Node | null, editorDom: HTMLElement): HTMLElement | null {
  const element = elementForNode(node)
  if (!element) return null

  const heading = element.matches(headingSelector)
    ? element
    : element.closest<HTMLElement>(headingSelector)
  if (heading && editorDom.contains(heading)) return heading

  const block = element.matches(blockSelector)
    ? element
    : element.closest<HTMLElement>(blockSelector)
  return block && block !== editorDom && editorDom.contains(block) ? block : null
}

export function scrollEditorTo(pos: number): void {
  const view = currentEditorView
  if (!view || !Number.isInteger(pos) || pos < 0 || pos > view.state.doc.content.size) return

  try {
    const nodeDom = view.nodeDOM(pos)
    const nodeBlock = blockForNode(nodeDom, view.dom)
    if (nodeBlock) {
      nodeBlock.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }

    const { node, offset } = view.domAtPos(pos)
    const offsetNode = node instanceof Element ? node.childNodes.item(offset) : null
    const block = blockForNode(offsetNode ?? node, view.dom)
    block?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  } catch {
    // The view may have been destroyed or the position may no longer map to DOM.
  }
}
