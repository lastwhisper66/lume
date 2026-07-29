// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import {
  HeadingSourceView,
  headingRevealPlugin,
  parseHeadingSource,
  resolveArrowNavigation,
  sourceCaretOffset,
  splitHeadingSource
} from './headingSource'

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

function createHeadingView(source: string): EditorView {
  const mount = document.createElement('div')
  document.body.appendChild(mount)
  const view = new EditorView(mount, {
    state: EditorState.create({
      doc: parse(source),
      plugins: [history(), headingRevealPlugin()]
    }),
    nodeViews: {
      heading: (node, editorView, getPos) => new HeadingSourceView(node, editorView, getPos)
    },
    dispatchTransaction(transaction) {
      view.updateState(view.state.apply(transaction))
    }
  })
  return view
}

function openHeadingSource(view: EditorView): HTMLTextAreaElement {
  const rendered = view.dom.querySelector<HTMLElement>('.heading-source-rendered')
  if (!rendered) throw new Error('Rendered heading not found')
  rendered.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  const textarea = view.dom.querySelector<HTMLTextAreaElement>('.heading-source-input')
  if (!textarea) throw new Error('Heading source textarea not found')
  return textarea
}

function inputSource(textarea: HTMLTextAreaElement, source: string): void {
  textarea.value = source
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))
}

describe('HeadingSourceView integration', () => {
  const views: EditorView[] = []

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    Object.defineProperties(Range.prototype, {
      getBoundingClientRect: {
        configurable: true,
        value: () => new DOMRect()
      },
      getClientRects: {
        configurable: true,
        value: () => []
      }
    })
  })

  afterEach(() => {
    for (const view of views) view.destroy()
    document.body.replaceChildren()
    vi.unstubAllGlobals()
  })

  function createView(source: string): EditorView {
    const view = createHeadingView(source)
    views.push(view)
    return view
  }

  it('soft-wraps, auto-resizes, and immediately serializes live input without replacing it', () => {
    const view = createView('# Old')
    const textarea = openHeadingSource(view)
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect(textarea.wrap).toBe('soft')
    expect(textarea.rows).toBe(1)
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 72 })

    inputSource(textarea, '# A much longer heading that should wrap')

    expect(serialize(view.state.doc).trimEnd()).toBe('# A much longer heading that should wrap')
    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(textarea.style.height).toBe('72px')
    expect(document.activeElement).toBe(textarea)
  })

  it('keeps the same textarea when the live heading level changes', () => {
    const view = createView('# Old')
    const textarea = openHeadingSource(view)

    inputSource(textarea, '## New')

    expect(view.state.doc.firstChild?.attrs.level).toBe(2)
    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(view.dom.querySelector('.heading-source-rendered')?.tagName).toBe('H2')
  })

  it('converts to a paragraph immediately when the space after the marker is removed', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    textarea.value = '#Title'
    textarea.setSelectionRange(1, 1)
    textarea.dispatchEvent(
      new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.textContent).toBe('#Title')
    expect(view.state.selection.$from.parentOffset).toBe(1)
    expect(document.activeElement).toBe(view.dom)
  })

  it('converts to a paragraph immediately when the source is replaced with plain text', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)

    inputSource(textarea, 'Plain text')

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.textContent).toBe('Plain text')
    expect(document.activeElement).toBe(view.dom)
  })

  it('finishes editing without changing the document on blur', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)

    textarea.dispatchEvent(new FocusEvent('blur'))

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
    expect(serialize(view.state.doc).trimEnd()).toBe('# Title')
  })

  it('lets Mod-S bubble to the global save path with the live document', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    inputSource(textarea, '# Edited title')
    let sourceSeenBySave = ''
    let defaultPreventedAtSave = true
    const saveListener = (event: KeyboardEvent): void => {
      sourceSeenBySave = serialize(view.state.doc).trimEnd()
      defaultPreventedAtSave = event.defaultPrevented
    }
    window.addEventListener('keydown', saveListener, { once: true })

    const notCanceled = textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true
      })
    )

    expect(notCanceled).toBe(true)
    expect(defaultPreventedAtSave).toBe(false)
    expect(sourceSeenBySave).toBe('# Edited title')
    expect(view.state.doc.firstChild?.type.name).toBe('heading')
  })

  it('splits at Enter into a heading and paragraph and selects the paragraph start', () => {
    const view = createView('# BeforeAfter')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(8, 8)

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(view.state.doc.childCount).toBe(2)
    expect(view.state.doc.child(0).type.name).toBe('heading')
    expect(view.state.doc.child(0).textContent).toBe('Before')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).textContent).toBe('After')
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph')
    expect(view.state.selection.$from.parentOffset).toBe(0)
    expect(document.activeElement).toBe(view.dom)
  })

  it('keeps the Enter split separate from prior live typing in history', () => {
    const view = createView('# Old')
    const textarea = openHeadingSource(view)
    inputSource(textarea, '# New text')
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(undo(view.state, view.dispatch)).toBe(true)

    expect(serialize(view.state.doc).trimEnd()).toBe('# New text')
    expect(view.state.doc.childCount).toBe(1)
  })

  it('routes Ctrl+Z through ProseMirror history and syncs the textarea', () => {
    const view = createView('# Old')
    const textarea = openHeadingSource(view)
    inputSource(textarea, '# Changed')

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true })
    )

    expect(serialize(view.state.doc).trimEnd()).toBe('# Old')
    expect(textarea.value).toBe('# Old')
    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
  })

  it('leaves the textarea active on Escape', () => {
    const view = createView('# Old')
    const textarea = openHeadingSource(view)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
  })

  it('deletes selected source and keeps a block-marker suffix as an ordinary paragraph', () => {
    const view = createView('# Before - item')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(8, 9)

    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))

    expect(view.state.doc.child(0).textContent).toBe('Before')
    expect(view.state.doc.child(1).type.name).toBe('paragraph')
    expect(view.state.doc.child(1).textContent).toBe('- item')
  })

  it('reveals the source when the selection enters the heading via keyboard', async () => {
    const view = createView('Intro\n\n# Heading')
    const headingPos = view.state.doc.child(0).nodeSize + 1
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos)))
    await Promise.resolve()

    const textarea = view.dom.querySelector<HTMLTextAreaElement>('.heading-source-input')
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    expect(textarea?.value).toBe('# Heading')
    expect(textarea?.selectionStart).toBe(0)
    expect(textarea?.selectionEnd).toBe(0)
  })

  it('moves into the previous block on ArrowUp from the heading', () => {
    const view = createView('Intro\n\n# Heading')
    const textarea = openHeadingSource(view)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Intro')
  })

  it('moves into the next block on ArrowDown from the heading', () => {
    const view = createView('# Heading\n\nBody')
    const textarea = openHeadingSource(view)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Body')
  })

  it('moves before the heading on ArrowLeft at the start of the source', () => {
    const view = createView('Intro\n\n# Heading')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(0, 0)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Intro')
  })

  it('moves after the heading on ArrowRight at the end of the source', () => {
    const view = createView('# Heading\n\nBody')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.selection.$from.parent.textContent).toBe('Body')
  })

  it('keeps the textarea active on ArrowRight inside the source', () => {
    const view = createView('# Heading')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(2, 2)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(document.activeElement).toBe(textarea)
  })

  it('stays in the source and moves the caret before the marker on ArrowUp at the top heading', () => {
    const view = createView('# Heading')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(3, 3)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(textarea.selectionStart).toBe(0)
    expect(textarea.selectionEnd).toBe(0)
  })

  it('stays in the source and moves the caret to the end on ArrowDown at the last heading', () => {
    const view = createView('# Heading')
    const textarea = openHeadingSource(view)
    textarea.setSelectionRange(3, 3)

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    )

    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(textarea.selectionStart).toBe(textarea.value.length)
    expect(textarea.selectionEnd).toBe(textarea.value.length)
  })
})

describe('parseHeadingSource', () => {
  it.each([
    ['# Title', 1, 'Title'],
    ['### Title', 3, 'Title'],
    ['###### Title #2', 6, 'Title #2']
  ])('parses %s as a heading', (source, level, text) => {
    expect(parseHeadingSource(source)).toEqual({ level, text })
  })

  it.each(['Title', '####### Title', '', '#NoSpace'])('treats %j as paragraph source', (source) => {
    expect(parseHeadingSource(source)).toEqual({ level: null, text: source })
  })
})

describe('sourceCaretOffset', () => {
  it('places the source caret before the marker at the very start of the text', () => {
    expect(sourceCaretOffset(4, 0, 20)).toBe(0)
  })

  it('places the source caret after the heading prefix at the clicked text offset', () => {
    expect(sourceCaretOffset(4, 5, 20)).toBe(9)
  })

  it('clamps the caret to the available source', () => {
    expect(sourceCaretOffset(4, 20, 12)).toBe(12)
  })
})

describe('resolveArrowNavigation', () => {
  const base = {
    collapsed: true,
    atStart: false,
    atEnd: false,
    firstRow: false,
    lastRow: false
  }

  it('does nothing when the selection is not collapsed', () => {
    expect(
      resolveArrowNavigation({ ...base, key: 'ArrowLeft', collapsed: false, atStart: true })
    ).toBeNull()
    expect(
      resolveArrowNavigation({ ...base, key: 'ArrowDown', collapsed: false, lastRow: true })
    ).toBeNull()
  })

  it('moves before the heading on ArrowLeft only at the start', () => {
    expect(resolveArrowNavigation({ ...base, key: 'ArrowLeft', atStart: true })).toBe('before')
    expect(resolveArrowNavigation({ ...base, key: 'ArrowLeft', atStart: false })).toBeNull()
  })

  it('moves after the heading on ArrowRight only at the end', () => {
    expect(resolveArrowNavigation({ ...base, key: 'ArrowRight', atEnd: true })).toBe('after')
    expect(resolveArrowNavigation({ ...base, key: 'ArrowRight', atEnd: false })).toBeNull()
  })

  it('moves before the heading on ArrowUp only from the first visual row', () => {
    expect(resolveArrowNavigation({ ...base, key: 'ArrowUp', firstRow: true })).toBe('before')
    expect(resolveArrowNavigation({ ...base, key: 'ArrowUp', firstRow: false })).toBeNull()
  })

  it('moves after the heading on ArrowDown only from the last visual row', () => {
    expect(resolveArrowNavigation({ ...base, key: 'ArrowDown', lastRow: true })).toBe('after')
    expect(resolveArrowNavigation({ ...base, key: 'ArrowDown', lastRow: false })).toBeNull()
  })

  it('ignores unrelated keys', () => {
    expect(resolveArrowNavigation({ ...base, key: 'Enter', atStart: true, atEnd: true })).toBeNull()
  })
})

describe('splitHeadingSource', () => {
  it.each([
    ['# BeforeAfter', 8, 8, { headingSource: '# Before', paragraphSource: 'After' }],
    ['## Before middle after', 9, 17, { headingSource: '## Before', paragraphSource: 'after' }],
    ['### Title', 0, 0, { headingSource: '### ', paragraphSource: 'Title' }],
    ['# Title', 7, 7, { headingSource: '# Title', paragraphSource: '' }],
    ['##   Title', 0, 0, { headingSource: '##   ', paragraphSource: 'Title' }],
    ['##\tTitle', 0, 0, { headingSource: '##\t', paragraphSource: 'Title' }],
    ['# Before middle after', 16, 8, { headingSource: '# Before', paragraphSource: 'after' }],
    ['### Title', -10, 100, { headingSource: '### ', paragraphSource: '' }]
  ])('splits %j from selection %d-%d', (source, selectionStart, selectionEnd, expected) => {
    expect(splitHeadingSource(source, selectionStart, selectionEnd)).toEqual(expected)
  })
})
