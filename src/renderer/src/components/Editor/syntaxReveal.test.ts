// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { syntaxRevealPlugin } from './syntaxReveal'

const views: EditorView[] = []

function createView(source: string): EditorView {
  const mount = document.body.appendChild(document.createElement('div'))
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: parse(source), plugins: [syntaxRevealPlugin] })
  })
  views.push(view)
  return view
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  document.body.replaceChildren()
})

describe('heading source reveal', () => {
  it('renders the real prefix in the root contenteditable without a heading NodeView', () => {
    const view = createView('# Title')
    const marker = view.dom.querySelector('.heading-source-marker')

    expect(view.dom.textContent).toBe('# Title')
    expect(view.dom.getAttribute('contenteditable')).toBe('true')
    expect(view.dom.querySelector('textarea')).toBeNull()
    expect(view.dom.querySelector('.heading-source-wrapper')).toBeNull()
    expect(view.dom.querySelector('[contenteditable]')).toBeNull()
    expect(marker?.textContent).toBe('# ')
  })

  it('activates a heading when a transaction moves the selection into it and deactivates it on exit', () => {
    const view = createView('Before\n\n## Title\n\nAfter')
    const headingPos = view.state.doc.child(0).nodeSize
    const paragraphPos = headingPos + view.state.doc.child(1).nodeSize

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos + 4)))
    expect(view.dom.querySelector('h2')?.classList.contains('heading-source-active')).toBe(true)

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, paragraphPos + 1))
    )
    expect(view.dom.querySelector('h2')?.classList.contains('heading-source-active')).toBe(false)
  })

  it('marks only the heading containing the selection as active', () => {
    const view = createView('# One\n\n## Two\n\n### Three')
    const secondHeadingPos = view.state.doc.child(0).nodeSize

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, secondHeadingPos + 4))
    )

    const headings = Array.from(view.dom.querySelectorAll('h1, h2, h3'))
    expect(headings.map((heading) => heading.classList.contains('heading-source-active'))).toEqual([
      false,
      true,
      false
    ])
  })

  it('finds the active heading through nested selection depths', () => {
    const view = createView('> ## Nested')
    let headingPos = -1
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') headingPos = pos
    })

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos + 4)))

    expect(view.dom.querySelector('h2')?.classList.contains('heading-source-active')).toBe(true)
  })

  it('allows a ProseMirror text selection inside the prefix in the same root contenteditable', () => {
    const view = createView('## Title')

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))

    expect(view.state.selection.from).toBe(2)
    expect(view.state.selection.$from.parent.type.name).toBe('heading')
    expect(view.state.selection.$from.parentOffset).toBe(1)
    expect(view.dom.querySelector('.heading-source-marker')?.textContent).toBe('## ')
    expect(view.dom.querySelector('[contenteditable]')).toBeNull()
  })
})

describe('existing syntax decorations', () => {
  it('keeps inline and link markers for a selection intersecting both ranges', () => {
    const view = createView('**bold** and [link](https://example.com)')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 12)))

    const markers = Array.from(view.dom.querySelectorAll('.md-marker'), (node) => node.textContent)
    expect(markers).toContain('**')
    expect(markers).toContain('[')
    expect(markers).toContain('](https://example.com)')
  })

  it('keeps the blockquote marker for a selection inside a quote', () => {
    const view = createView('> Quote')
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))

    expect(view.dom.querySelector('.md-marker')?.textContent).toBe('> ')
  })
})
