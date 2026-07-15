// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from '../markdown/parser'
import { serialize } from '../markdown/serializer'
import { flushTransientEdits } from '../transientEdits'
import {
  HeadingSourceView,
  parseHeadingSource,
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
    state: EditorState.create({ doc: parse(source), plugins: [history()] }),
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

  it('keeps transient invalid heading source as a draft in the same textarea', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)

    inputSource(textarea, '#Title')

    expect(serialize(view.state.doc).trimEnd()).toBe('# Title')
    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(textarea.value).toBe('#Title')
    expect(document.activeElement).toBe(textarea)
  })

  it('live-syncs a transient invalid draft once it becomes a valid heading again', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    inputSource(textarea, '#Title')
    textarea.setSelectionRange(1, 1)

    inputSource(textarea, '# Corrected')

    expect(serialize(view.state.doc).trimEnd()).toBe('# Corrected')
    expect(view.dom.querySelector('.heading-source-input')).toBe(textarea)
    expect(textarea.value).toBe('# Corrected')
  })

  it('commits an invalid draft as a paragraph on blur', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    inputSource(textarea, 'Plain text')

    textarea.dispatchEvent(new FocusEvent('blur'))

    expect(view.dom.querySelector('.heading-source-input')).toBeNull()
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.textContent).toBe('Plain text')
  })

  it('commits an invalid draft before Mod-S bubbles to the global save path', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    inputSource(textarea, 'Save this draft')
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
    expect(sourceSeenBySave).toBe('Save this draft')
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
  })

  it('flushes an invalid draft before lifecycle teardown without double-dispatching', () => {
    const view = createView('# Title')
    const textarea = openHeadingSource(view)
    const dispatch = vi.spyOn(view, 'dispatch')
    inputSource(textarea, 'Lifecycle draft')

    flushTransientEdits()

    expect(view.state.doc.firstChild?.type.name).toBe('paragraph')
    expect(view.state.doc.firstChild?.textContent).toBe('Lifecycle draft')
    expect(dispatch).toHaveBeenCalledTimes(1)

    textarea.dispatchEvent(new FocusEvent('blur'))
    view.destroy()
    expect(dispatch).toHaveBeenCalledTimes(1)
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
  it('places the source caret after the heading prefix at the clicked text offset', () => {
    expect(sourceCaretOffset(4, 5, 20)).toBe(9)
  })

  it('clamps the caret to the available source', () => {
    expect(sourceCaretOffset(4, 20, 12)).toBe(12)
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
