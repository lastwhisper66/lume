// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { buildPlugins } from './plugins'
import { linkClickPlugin, linkTargetString, parseLinkTarget } from './syntaxReveal'

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

  it('reveals the link target in an editable input', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLInputElement>('.md-link-input')
    expect(input).not.toBeNull()
    expect(input?.value).toBe('http://a.com')
  })

  it('commits an edited URL and title back to the link mark on blur', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLInputElement>('.md-link-input')!
    input.value = 'http://b.com "docs"'
    input.dispatchEvent(new FocusEvent('blur'))

    expect(serialize(view.state.doc).trimEnd()).toBe('[text](http://b.com "docs")')
  })

  it('unwraps the link when the URL is cleared', () => {
    const view = createView('[text](http://a.com)')
    selectInsideLink(view, 3)

    const input = view.dom.querySelector<HTMLInputElement>('.md-link-input')!
    input.value = ''
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
