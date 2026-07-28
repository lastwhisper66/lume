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

// The heading source NodeView wraps its rendered heading in a `display: contents`
// element, which generates no layout box (its getClientRects() is empty). Resolve
// such wrappers to the first child that actually renders, so scroll math reads a
// real position instead of an empty { top: 0 } rect.
function renderedBox(el: HTMLElement): HTMLElement {
  if (el.getClientRects().length > 0) return el
  for (const child of el.children) {
    if (child instanceof HTMLElement && child.getClientRects().length > 0) return child
  }
  return el
}

function nearestScrollable(el: HTMLElement): HTMLElement | null {
  let node = el.parentElement
  while (node) {
    const overflowY = getComputedStyle(node).overflowY
    if (
      (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
      node.scrollHeight > node.clientHeight
    ) {
      return node
    }
    node = node.parentElement
  }
  return null
}

function scrollTargetForPos(view: EditorView, pos: number): HTMLElement | null {
  // nodeDOM(pos) returns the node's own outermost element: the block itself for
  // plain blocks, or a NodeView wrapper (e.g. the heading source wrapper) whose
  // block child blockForNode can't reach by walking ancestors. Scroll to that
  // element directly, using blockForNode only to refine it when possible.
  const nodeDom = view.nodeDOM(pos)
  if (nodeDom instanceof HTMLElement && nodeDom !== view.dom && view.dom.contains(nodeDom)) {
    return renderedBox(blockForNode(nodeDom, view.dom) ?? nodeDom)
  }

  const { node, offset } = view.domAtPos(pos)
  const offsetNode = node instanceof Element ? node.childNodes.item(offset) : null
  const block = blockForNode(offsetNode ?? node, view.dom)
  return block ? renderedBox(block) : null
}

export function scrollEditorTo(pos: number): void {
  const view = currentEditorView
  if (!view || !Number.isInteger(pos) || pos < 0 || pos > view.state.doc.content.size) return

  try {
    const target = scrollTargetForPos(view, pos)
    if (!target) return

    const scroller = nearestScrollable(target)
    if (scroller) {
      const top =
        scroller.scrollTop +
        target.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top
      scroller.scrollTo({ top, behavior: 'smooth' })
    } else {
      target.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  } catch {
    // The view may have been destroyed or the position may no longer map to DOM.
  }
}
