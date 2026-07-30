// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { buildPlugins } from './plugins'
import { linkClickPlugin } from './syntaxReveal'

describe('link Ctrl+Click', () => {
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
