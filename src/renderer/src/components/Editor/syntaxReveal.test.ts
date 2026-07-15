// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { buildPlugins } from './plugins'
import { linkClickPlugin, linkNavPlugin, linkTargetString, parseLinkTarget } from './syntaxReveal'

describe('parseLinkTarget', () => {
  it('reads a bare destination', () => {
    expect(parseLinkTarget('http://a.com')).toEqual({ href: 'http://a.com', title: null })
  })

  it('reads a destination with a double-quoted title', () => {
    expect(parseLinkTarget('http://a.com "hi"')).toEqual({ href: 'http://a.com', title: 'hi' })
  })

  it('reads a destination with a single-quoted title', () => {
    expect(parseLinkTarget("http://a.com 'hi'")).toEqual({ href: 'http://a.com', title: 'hi' })
  })

  it('reads an angle-bracketed destination that contains spaces', () => {
    expect(parseLinkTarget('<http://a b.com> "t"')).toEqual({ href: 'http://a b.com', title: 't' })
  })

  it('unescapes quotes inside the title', () => {
    expect(parseLinkTarget('http://a.com "say \\"hi\\""')).toEqual({
      href: 'http://a.com',
      title: 'say "hi"'
    })
  })

  it('trims surrounding whitespace and treats empty input as no link', () => {
    expect(parseLinkTarget('  http://a.com  ')).toEqual({ href: 'http://a.com', title: null })
    expect(parseLinkTarget('')).toEqual({ href: '', title: null })
  })
})

describe('linkTargetString', () => {
  it('renders a bare destination without quotes', () => {
    expect(linkTargetString('http://a.com', null)).toBe('http://a.com')
  })

  it('appends a quoted title when present', () => {
    expect(linkTargetString('http://a.com', 'hi')).toBe('http://a.com "hi"')
  })

  it('round-trips through parseLinkTarget', () => {
    const cases: Array<[string, string | null]> = [
      ['http://a.com', null],
      ['http://a.com', 'hi'],
      ['http://a.com', 'say "hi"']
    ]
    for (const [href, title] of cases) {
      expect(parseLinkTarget(linkTargetString(href, title))).toEqual({ href, title })
    }
  })
})

describe('link reveal integration', () => {
  const views: EditorView[] = []

  afterEach(() => {
    for (const view of views) view.destroy()
    views.length = 0
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  function createView(source: string): EditorView {
    const mount = document.createElement('div')
    mount.className = 'lume-editor'
    document.body.appendChild(mount)
    const view = new EditorView(mount, {
      state: EditorState.create({ doc: parse(source), plugins: buildPlugins() }),
      dispatchTransaction(transaction) {
        view.updateState(view.state.apply(transaction))
      }
    })
    views.push(view)
    return view
  }

  function selectInsideLink(view: EditorView, pos: number): void {
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
  }

  // Drive the real linkNavPlugin instance living inside the view's state.
  function pressArrow(view: EditorView, key: 'ArrowLeft' | 'ArrowRight'): boolean {
    const plugin = linkNavPlugin()
    return (
      plugin.props.handleKeyDown!.call(plugin, view, new KeyboardEvent('keydown', { key })) ?? false
    )
  }

  it('reveals the link target in an editable field', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLElement>('.md-link-input')
    expect(input).not.toBeNull()
    expect(input?.getAttribute('contenteditable')).toBe('true')
    expect(input?.textContent).toBe('http://a.com')
  })

  it('enters the URL editor when pressing ArrowRight at the end of the link text', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 5)

    expect(pressArrow(view, 'ArrowRight')).toBe(true)
  })

  it('does not enter the URL editor from the middle of the link text', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    expect(pressArrow(view, 'ArrowRight')).toBe(false)
  })

  it('lets ArrowLeft move into the link text from the text-end side', () => {
    const view = createView('[text](http://a.com)')
    // Arriving at pos 5 from the left marks the caret as the text-end side.
    selectInsideLink(view, 5)

    expect(pressArrow(view, 'ArrowLeft')).toBe(false)
  })

  it('collapses the reveal when the caret rests just after the link (afterLink side)', () => {
    const view = createView('[text](http://a.com) tail')
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 8)))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)))

    // Approaching the boundary from the right hides the `](url)` editor entirely...
    expect(view.dom.querySelector('.md-link-input')).toBeNull()
    // ...and ArrowRight passes the link instead of diving into the URL.
    expect(pressArrow(view, 'ArrowRight')).toBe(false)
  })

  it('keeps the reveal shown when the caret is at the link text end (textEnd side)', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 5)

    expect(view.dom.querySelector('.md-link-input')).not.toBeNull()
  })

  it('does not grab arrow keys while the URL editor already has focus', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 5)
    view.dom.querySelector<HTMLElement>('.md-link-input')!.focus()

    expect(pressArrow(view, 'ArrowRight')).toBe(false)
  })

  it('commits an edited URL and title back to the link mark on blur', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLElement>('.md-link-input')!
    input.textContent = 'http://b.com "docs"'
    input.dispatchEvent(new FocusEvent('blur'))

    expect(serialize(view.state.doc).trimEnd()).toBe('[text](http://b.com "docs")')
  })

  it('unwraps the link when the URL is cleared', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLElement>('.md-link-input')!
    input.textContent = ''
    input.dispatchEvent(new FocusEvent('blur'))

    expect(serialize(view.state.doc).trimEnd()).toBe('text')
  })

  it('opens the link externally on Ctrl+Click and leaves the document unchanged', () => {
    const view = createView('[text](http://a.com)')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    const handled = linkClickPlugin.props.handleClick!.call(
      linkClickPlugin,
      view,
      3,
      new MouseEvent('click', { ctrlKey: true })
    )

    expect(handled).toBe(true)
    expect(open).toHaveBeenCalledWith('http://a.com', '_blank')
  })

  it('ignores a plain click so the cursor can be placed for editing', () => {
    const view = createView('[text](http://a.com)')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)

    const handled = linkClickPlugin.props.handleClick!.call(
      linkClickPlugin,
      view,
      3,
      new MouseEvent('click')
    )

    expect(handled).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })
})
