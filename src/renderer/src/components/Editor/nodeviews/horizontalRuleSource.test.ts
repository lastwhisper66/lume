// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { history } from 'prosemirror-history'
import { EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import { buildInputRules } from '../inputrules'
import { HeadingSourceView, headingRevealPlugin } from './headingSource'
import {
  HorizontalRuleView,
  horizontalRuleRevealPlugin,
  isHorizontalRuleSource,
  parseSourceBlocks
} from './horizontalRuleSource'

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    return
  }
  unobserve(): void {
    return
  }
  disconnect(): void {
    return
  }
}

function createView(source: string, withInputRules = false): EditorView {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const plugins = [history(), horizontalRuleRevealPlugin()]
  if (withInputRules) plugins.unshift(buildInputRules())
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: parse(source), plugins }),
    nodeViews: {
      horizontal_rule: (node, editorView, getPos) =>
        new HorizontalRuleView(node, editorView, getPos)
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  return view
}

function createComboView(source: string): EditorView {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parse(source),
      plugins: [history(), headingRevealPlugin(), horizontalRuleRevealPlugin()]
    }),
    nodeViews: {
      heading: (node, editorView, getPos) => new HeadingSourceView(node, editorView, getPos),
      horizontal_rule: (node, editorView, getPos) =>
        new HorizontalRuleView(node, editorView, getPos)
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  return view
}

function openSource(view: EditorView): HTMLInputElement {
  const rendered = view.dom.querySelector<HTMLElement>('.hr-source-rendered')
  if (!rendered) throw new Error('Rendered horizontal rule not found')
  rendered.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  const input = view.dom.querySelector<HTMLInputElement>('.hr-source-input')
  if (!input) throw new Error('Horizontal rule source input not found')
  return input
}

function typeText(view: EditorView, text: string): void {
  const { from, to } = view.state.selection
  view.someProp('handleTextInput', (handler) =>
    handler(view, from, to, text, () => view.state.tr.insertText(text, from, to))
  )
}

describe('isHorizontalRuleSource / parseSourceBlocks', () => {
  it('accepts every GFM thematic-break spelling', () => {
    expect(isHorizontalRuleSource('---')).toBe(true)
    expect(isHorizontalRuleSource('***')).toBe(true)
    expect(isHorizontalRuleSource('___')).toBe(true)
    expect(isHorizontalRuleSource('-----')).toBe(true)
    expect(isHorizontalRuleSource('- - -')).toBe(true)
  })

  it('rejects sources that are not a lone thematic break', () => {
    expect(isHorizontalRuleSource('--')).toBe(false)
    expect(isHorizontalRuleSource('# Heading')).toBe(false)
    expect(isHorizontalRuleSource('plain')).toBe(false)
    expect(isHorizontalRuleSource('')).toBe(false)
  })

  it('falls back to an empty paragraph for blank source', () => {
    const blocks = parseSourceBlocks('')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type.name).toBe('paragraph')
    expect(blocks[0].childCount).toBe(0)
  })

  it('parses non-rule source into its blocks', () => {
    const blocks = parseSourceBlocks('# Title')
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type.name).toBe('heading')
    expect(blocks[0].textContent).toBe('Title')
  })
})

describe('HorizontalRuleView integration', () => {
  const views: EditorView[] = []

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    const rect = { configurable: true, value: (): DOMRect => new DOMRect() }
    const rects = { configurable: true, value: (): DOMRect[] => [] }
    Object.defineProperties(Range.prototype, { getBoundingClientRect: rect, getClientRects: rects })
    Object.defineProperties(Element.prototype, {
      getBoundingClientRect: rect,
      getClientRects: rects
    })
  })

  afterEach(() => {
    for (const view of views) view.destroy()
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function makeView(source: string, withInputRules = false): EditorView {
    const view = createView(source, withInputRules)
    views.push(view)
    return view
  }

  function makeComboView(source: string): EditorView {
    const view = createComboView(source)
    views.push(view)
    return view
  }

  it('reveals --- and focuses the input on mousedown', () => {
    const view = makeView('---')
    const input = openSource(view)
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input.value).toBe('---')
    expect(document.activeElement).toBe(input)
    expect(view.dom.querySelector('.hr-source-rendered')?.hasAttribute('hidden')).toBe(true)
  })

  it('reveals the source when a NodeSelection lands on the rule', async () => {
    const view = makeView('before\n\n---')
    vi.spyOn(view, 'hasFocus').mockReturnValue(true)
    let hrPos = -1
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'horizontal_rule') hrPos = pos
    })
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)))
    await Promise.resolve()
    const input = view.dom.querySelector<HTMLInputElement>('.hr-source-input')
    expect(input).toBeInstanceOf(HTMLInputElement)
    expect(input?.value).toBe('---')
  })

  it('places the caret at the start of --- when entered from above', async () => {
    const view = makeView('above\n\n---\n\nbelow')
    vi.spyOn(view, 'hasFocus').mockReturnValue(true)
    let hrPos = -1
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'horizontal_rule') hrPos = pos
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)))
    await Promise.resolve()
    const input = view.dom.querySelector<HTMLInputElement>('.hr-source-input')
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe(0)
  })

  it('places the caret at the end of --- when entered from below', async () => {
    const view = makeView('above\n\n---\n\nbelow')
    vi.spyOn(view, 'hasFocus').mockReturnValue(true)
    let hrPos = -1
    view.state.doc.forEach((node, pos) => {
      if (node.type.name === 'horizontal_rule') hrPos = pos
    })
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, hrPos + 2)))
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, hrPos)))
    await Promise.resolve()
    const input = view.dom.querySelector<HTMLInputElement>('.hr-source-input')
    expect(input?.selectionStart).toBe(3)
    expect(input?.selectionEnd).toBe(3)
  })

  it('keeps the rule and normalizes to --- when the source stays a thematic break', () => {
    const view = makeView('---')
    const input = openSource(view)
    input.value = '***'
    input.dispatchEvent(new FocusEvent('blur'))

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('horizontal_rule')
    expect(serialize(view.state.doc).trim()).toBe('---')
  })

  it('converts the rule into a heading when edited and blurred', () => {
    const view = makeView('---')
    const input = openSource(view)
    input.value = '# Heading'
    input.dispatchEvent(new FocusEvent('blur'))

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(view.state.doc.firstChild?.textContent).toBe('Heading')
  })

  it('converts the rule into an empty paragraph when the source is cleared', () => {
    const view = makeView('---')
    const input = openSource(view)
    input.value = ''
    input.dispatchEvent(new FocusEvent('blur'))

    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.childCount).toBe(0)
  })

  it('exits after the rule on Enter without changing the document', () => {
    const view = makeView('---\n\nafter')
    const input = openSource(view)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.state.doc.child(0).type.name).toBe('horizontal_rule')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
  })

  it('reveals a following heading when ArrowDown leaves the rule', async () => {
    const view = makeComboView('---\n\n# Title')
    const input = openSource(view)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await Promise.resolve()

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.dom.querySelector('.heading-source-input')).toBeInstanceOf(HTMLTextAreaElement)
    expect(view.state.selection.$head.parent.type.name).toBe('heading')
  })

  it('reveals a preceding heading when ArrowUp leaves the rule', async () => {
    const view = makeComboView('# Title\n\n---')
    const input = openSource(view)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    await Promise.resolve()

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.dom.querySelector('.heading-source-input')).toBeInstanceOf(HTMLTextAreaElement)
    expect(view.state.selection.$head.parent.type.name).toBe('heading')
  })

  it('reveals a following heading when ArrowRight leaves the end of the rule', async () => {
    const view = makeComboView('---\n\n# Title')
    const input = openSource(view)
    input.setSelectionRange(input.value.length, input.value.length)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await Promise.resolve()

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.dom.querySelector('.heading-source-input')).toBeInstanceOf(HTMLTextAreaElement)
    expect(view.state.selection.$head.parent.type.name).toBe('heading')
  })

  it('reveals a preceding heading when ArrowLeft leaves the start of the rule', async () => {
    const view = makeComboView('# Title\n\n---')
    const input = openSource(view)
    input.setSelectionRange(0, 0)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))
    await Promise.resolve()

    expect(view.dom.querySelector('.hr-source-input')).toBeNull()
    expect(view.dom.querySelector('.heading-source-input')).toBeInstanceOf(HTMLTextAreaElement)
    expect(view.state.selection.$head.parent.type.name).toBe('heading')
  })

  it('commits an invalid draft as a paragraph when Ctrl+S flushes transient edits', () => {
    const view = makeView('---')
    const input = openSource(view)
    input.value = 'Draft text'

    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true, cancelable: true })
    )

    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.textContent).toBe('Draft text')
  })

  it('creates a thematic break when --- is typed on an empty line', () => {
    const view = makeView('--', true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    typeText(view, '-')

    expect(view.state.doc.child(0).type.name).toBe('horizontal_rule')
  })

  it('creates a thematic break when *** is typed on an empty line', () => {
    const view = makeView('**', true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)))
    typeText(view, '*')

    expect(view.state.doc.child(0).type.name).toBe('horizontal_rule')
  })

  it('does not convert to a rule when there is leading text', () => {
    const view = makeView('x--', true)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)))
    typeText(view, '-')

    expect(view.state.doc.child(0).type.name).toBe('paragraph')
  })
})
