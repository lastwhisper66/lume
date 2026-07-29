// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { redo, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { schema } from './schema/gfm'
import { buildPlugins } from './plugins'
import { isTransientTransaction } from './transientEdits'
import { findInlineSource, findRevealRun, revealCaretOffset } from './inlineSourceReveal'

/** 文档中第一个带指定标记的文本节点的 [from,to) 位置 */
function firstMarkRun(doc: PMNode, markName: string): { from: number; to: number } {
  let run: { from: number; to: number } | null = null
  doc.descendants((node, pos) => {
    if (run) return false
    if (node.isText && node.marks.some((m) => m.type.name === markName)) {
      run = { from: pos, to: pos + node.nodeSize }
      return false
    }
    return undefined
  })
  if (!run) throw new Error(`no ${markName} run found`)
  return run
}

function stateWithCaret(source: string, pos: number): EditorState {
  const state = EditorState.create({ doc: parse(source), schema })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

describe('revealCaretOffset', () => {
  it('lands at the source start when the caret was at the run start', () => {
    expect(revealCaretOffset('**world**', 'world', 0)).toBe(0)
  })

  it('lands at the source end when the caret was at the run end', () => {
    expect(revealCaretOffset('**world**', 'world', 5)).toBe(9)
  })

  it('aligns an interior caret past the opening delimiter', () => {
    expect(revealCaretOffset('**world**', 'world', 2)).toBe(4)
  })

  it('falls back to the raw offset when the rendered text is not a substring', () => {
    expect(revealCaretOffset('**a*b*c**', 'abc', 1)).toBe(1)
  })
})

describe('findRevealRun', () => {
  it('finds a strong run when the caret is inside it', () => {
    const state = stateWithCaret('Hello **world**', 9)
    const expected = firstMarkRun(state.doc, 'strong')
    expect(findRevealRun(state.selection)).toEqual(expected)
  })

  it('finds a run when the caret merely touches its edge (single-char marks)', () => {
    const doc = parse('a *b* c')
    const run = firstMarkRun(doc, 'em')
    expect(findRevealRun(stateWithCaret('a *b* c', run.from).selection)).toEqual(run)
  })

  it('finds inline code and strikethrough runs', () => {
    const codeState = stateWithCaret('x `y` z', firstMarkRun(parse('x `y` z'), 'code').from + 1)
    expect(findRevealRun(codeState.selection)?.from).toBe(firstMarkRun(codeState.doc, 'code').from)

    const strikeState = stateWithCaret(
      '~~gone~~',
      firstMarkRun(parse('~~gone~~'), 'strikethrough').from + 1
    )
    expect(findRevealRun(strikeState.selection)?.from).toBe(
      firstMarkRun(strikeState.doc, 'strikethrough').from
    )
  })

  it('returns null for plain text', () => {
    expect(findRevealRun(stateWithCaret('just text', 3).selection)).toBeNull()
  })

  it('does not reveal inline marks inside a heading (headingSource owns that)', () => {
    const doc = parse('# **bold**')
    const run = firstMarkRun(doc, 'strong')
    expect(findRevealRun(stateWithCaret('# **bold**', run.from + 1).selection)).toBeNull()
  })

  it('excludes link-marked text (handled by the link reveal instead)', () => {
    const state = stateWithCaret('[text](http://a.com)', 3)
    expect(findRevealRun(state.selection)).toBeNull()
  })

  it('returns null for a non-empty selection', () => {
    const doc = parse('Hello **world**')
    const run = firstMarkRun(doc, 'strong')
    const base = EditorState.create({ doc, schema })
    const state = base.apply(base.tr.setSelection(TextSelection.create(base.doc, run.from, run.to)))
    expect(findRevealRun(state.selection)).toBeNull()
  })
})

describe('inline source reveal integration', () => {
  const views: EditorView[] = []

  beforeEach(() => {
    // jsdom 没实现布局，undo/scrollIntoView 会走到 coordsAtPos → getClientRects。
    // 与 headingSource.test.ts 一致，桩掉矩形测量避免崩溃。
    const rectStubs = {
      getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
      getClientRects: { configurable: true, value: () => [] as unknown as DOMRectList }
    }
    Object.defineProperties(Range.prototype, rectStubs)
    Object.defineProperties(Element.prototype, rectStubs)
  })

  afterEach(() => {
    for (const view of views) view.destroy()
    views.length = 0
    document.body.replaceChildren()
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

  function caretInto(view: EditorView, markName: string): void {
    const run = firstMarkRun(view.state.doc, markName)
    const mid = Math.floor((run.from + run.to) / 2)
    view.focus()
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, mid)))
  }

  /**
   * 通用流程：揭示 markName 片段 → 在 inline_source 内执行 edit → 光标移到文档首（离开
   * 该片段）触发收起。供「跨 dissolve 撤销/重做」用例复用（源码首字符位置通过回调拿到）。
   */
  function revealEditLeave(
    source: string,
    markName: string,
    edit: (view: EditorView, src: { pos: number; node: PMNode }) => void
  ): EditorView {
    const view = createView(source)
    caretInto(view, markName)
    edit(view, findInlineSource(view.state)!)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    return view
  }

  it('reveals a strong run as an editable inline_source holding its Markdown', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')

    const found = findInlineSource(view.state)
    expect(found).not.toBeNull()
    expect(found?.node.textContent).toBe('**world**')
    // Design B: delimiters stay bare while the inner text carries the real mark
    // (so edits record marks in history → cross-dissolve undo stays lossless).
    const content = found!.node.content
    expect(content.firstChild?.marks.length).toBe(0) // leading `**` is bare
    expect(found!.node.rangeHasMark(0, content.size, schema.marks.strong)).toBe(true) // inner is strong
  })

  it('reveals single-character emphasis (caret only touches the edge)', () => {
    const view = createView('a *b* c')
    caretInto(view, 'em')
    expect(findInlineSource(view.state)?.node.textContent).toBe('*b*')
  })

  it('dissolves back to the original mark when the caret leaves', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    expect(findInlineSource(view.state)).not.toBeNull()

    // move the caret to the very start of the document, outside the run
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))

    expect(findInlineSource(view.state)).toBeNull()
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
  })

  it('dissolves the old run and reveals the next in a single step when jumping between formats', () => {
    const view = createView('**bold** and *italic*')
    caretInto(view, 'strong')
    expect(findInlineSource(view.state)?.node.textContent).toBe('**bold**')

    // Jump straight into the italic run: the bold source must dissolve AND the
    // italic run must reveal within this one dispatch (no second click needed).
    caretInto(view, 'em')

    expect(findInlineSource(view.state)?.node.textContent).toBe('*italic*')
    // the previously-revealed bold run is rendered back to a strong mark
    expect(serialize(view.state.doc).trimEnd()).toBe('**bold** and *italic*')
  })

  it('does not immediately re-reveal after exiting to the run boundary', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!

    // exit to the node's left boundary (as ArrowLeft out of the source would)
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, src.pos)))

    // suppression keeps it dissolved instead of bouncing straight back in
    expect(findInlineSource(view.state)).toBeNull()
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.strong)).toBe(
      true
    )
  })

  it('dissolves on blur and stays dissolved while unfocused', async () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    expect(findInlineSource(view.state)).not.toBeNull()

    ;(view.dom as HTMLElement).blur()
    view.dom.dispatchEvent(new FocusEvent('blur'))
    await Promise.resolve()

    expect(view.hasFocus()).toBe(false)
    expect(findInlineSource(view.state)).toBeNull()
  })

  it('re-parses edited source on exit — deleting delimiters demotes bold to italic', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    // replace the whole source content `**world**` with `*world*`
    const from = src.pos + 1
    const to = src.pos + src.node.nodeSize - 1
    view.dispatch(view.state.tr.insertText('*world*', from, to))

    // leave the run
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))

    expect(findInlineSource(view.state)).toBeNull()
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.em)).toBe(true)
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.strong)).toBe(
      false
    )
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello *world*')
  })

  it('promotes italic back to bold when re-adding a delimiter after a demote', () => {
    // 用户报告：**world** 删一个 * 变斜体后，补一个 * 应重新变粗体（不能停留为字面 *world*）。
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    view.dispatch(view.state.tr.delete(src.pos + 1, src.pos + 2)) // 删前导 * → *world**
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))) // 离开 → em + 游离 *
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.em)).toBe(true)

    caretInto(view, 'em') // 重新进入斜体，揭示 *world*
    const em = findInlineSource(view.state)!
    view.dispatch(view.state.tr.insertText('*', em.pos + 1)) // 前面补 * → 节点 **world*（游离 * 在节点外）
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))) // 离开 → 吸收游离 * 重解析
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.strong)).toBe(
      true
    )
  })

  it('promotes back to bold when the demote left a leading stray delimiter', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    const end = src.pos + src.node.nodeSize - 1
    view.dispatch(view.state.tr.delete(end - 1, end)) // 删尾部一个 * → **world*
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1))) // 离开 → 游离 * + em
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.em)).toBe(true)

    caretInto(view, 'em')
    const em = findInlineSource(view.state)!
    view.dispatch(view.state.tr.insertText('*', em.pos + em.node.nodeSize - 1)) // 末尾补 * → *world**
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
    expect(view.state.doc.rangeHasMark(0, view.state.doc.content.size, schema.marks.strong)).toBe(
      true
    )
  })

  /** 在 view 上把光标停到 pos，再触发一次真实按键（走 handleKeyDown 链） */
  function pressKey(view: EditorView, key: string, pos: number): boolean {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
    return (
      view.someProp('handleKeyDown', (f) => f(view, new KeyboardEvent('keydown', { key }))) ?? false
    )
  }

  it('Delete removes the trailing delimiter inside the source instead of inserting a newline', () => {
    // 用户报告：`*斜体|*`（光标在闭合分隔符前）按 Delete 不删除、反而换行。
    // 源码节点是 code:true（保留空白），原生前向删除在边界会插入 `\n`；接管到模型层修复。
    const view = createView('a *italic* b')
    caretInto(view, 'em')
    const src = findInlineSource(view.state)!
    expect(src.node.textContent).toBe('*italic*')
    const contentEnd = src.pos + src.node.nodeSize - 1

    const handled = pressKey(view, 'Delete', contentEnd - 1) // 光标在闭合 * 前
    expect(handled).toBe(true)
    // 删掉的是闭合 *，没有出现换行；节点内容变为 `*italic`
    expect(findInlineSource(view.state)?.node.textContent).toBe('*italic')
    expect(view.state.doc.textContent).not.toContain('\n')
  })

  it('Backspace removes the leading delimiter inside the source', () => {
    const view = createView('a *italic* b')
    caretInto(view, 'em')
    const src = findInlineSource(view.state)!
    const contentStart = src.pos + 1

    const handled = pressKey(view, 'Backspace', contentStart + 1) // 光标在开头 * 后
    expect(handled).toBe(true)
    expect(findInlineSource(view.state)?.node.textContent).toBe('italic*')
  })

  it('leaves the boundary Backspace/Delete to the default commands (exit/dissolve)', () => {
    const view = createView('a *italic* b')
    caretInto(view, 'em')
    const src = findInlineSource(view.state)!
    const contentEnd = src.pos + src.node.nodeSize - 1

    // 光标在源码末尾按 Delete：不由本插件处理，交默认命令
    expect(pressKey(view, 'Delete', contentEnd)).toBe(false)
    // 光标在源码开头按 Backspace：同样交默认
    const src2 = findInlineSource(view.state)!
    expect(pressKey(view, 'Backspace', src2.pos + 1)).toBe(false)
  })

  it('undoes an edit while the span is still revealed', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    const from = src.pos + 1
    const to = src.pos + src.node.nodeSize - 1
    view.dispatch(view.state.tr.insertText('**worldX**', from, to))
    expect(findInlineSource(view.state)?.node.textContent).toBe('**worldX**')

    // undo while the source is still revealed reverts the edit cleanly
    undo(view.state, view.dispatch)
    expect(findInlineSource(view.state)?.node.textContent).toBe('**world**')
  })

  it('undoes an edit even after the span was dissolved (cross-dissolve undo)', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    // insert 'X' right before the closing `**`, inside the revealed source
    const at = src.pos + 1 + src.node.textContent.indexOf('**', 2)
    view.dispatch(view.state.tr.insertText('X', at))
    expect(findInlineSource(view.state)?.node.textContent).toBe('**worldX**')

    // leave the run so the source dissolves back to a strong mark
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(findInlineSource(view.state)).toBeNull()
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **worldX**')

    // the edit and dissolve are sandwiched; undo must still revert the 'X'
    undo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
  })

  it('cross-dissolve undo works after a multi-character replacement', () => {
    const view = revealEditLeave('Hello **world**', 'strong', (v, src) => {
      const from = src.pos + 1 + 2 // just past the opening **
      v.dispatch(v.state.tr.insertText('there', from, from + 'world'.length))
    })
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **there**')
    undo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
  })

  it('cross-dissolve undo works for single-character emphasis', () => {
    const view = revealEditLeave('a *b* c', 'em', (v, src) => {
      const at = src.pos + 1 + src.node.textContent.indexOf('*', 1)
      v.dispatch(v.state.tr.insertText('X', at))
    })
    expect(serialize(view.state.doc).trimEnd()).toBe('a *bX* c')
    undo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('a *b* c')
  })

  it('cross-dissolve undo works for inline code and strikethrough', () => {
    const codeView = revealEditLeave('x `y` z', 'code', (v, src) => {
      const at = src.pos + 1 + src.node.textContent.indexOf('`', 1)
      v.dispatch(v.state.tr.insertText('Y', at))
    })
    expect(serialize(codeView.state.doc).trimEnd()).toBe('x `yY` z')
    undo(codeView.state, codeView.dispatch)
    expect(serialize(codeView.state.doc).trimEnd()).toBe('x `y` z')

    const strikeView = revealEditLeave('a ~~gone~~ b', 'strikethrough', (v, src) => {
      const at = src.pos + 1 + src.node.textContent.indexOf('~~', 2)
      v.dispatch(v.state.tr.insertText('X', at))
    })
    expect(serialize(strikeView.state.doc).trimEnd()).toBe('a ~~goneX~~ b')
    undo(strikeView.state, strikeView.dispatch)
    expect(serialize(strikeView.state.doc).trimEnd()).toBe('a ~~gone~~ b')
  })

  it('cross-dissolve undo works after deleting an inner character (the case that used to corrupt)', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    // delete the 'l' inside the revealed source; the deleted char carries strong,
    // so its undo re-inserts a strong char and merges cleanly (no mark fragmentation)
    const at = src.pos + 1 + src.node.textContent.indexOf('l')
    view.dispatch(view.state.tr.delete(at, at + 1))
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **word**')

    undo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
  })

  it('redoes a cross-dissolve edit after an undo', () => {
    const view = revealEditLeave('Hello **world**', 'strong', (v, src) => {
      const at = src.pos + 1 + src.node.textContent.indexOf('**', 2)
      v.dispatch(v.state.tr.insertText('X', at))
    })
    undo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
    redo(view.state, view.dispatch)
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **worldX**')
  })

  it('dissolves a nested run via the whole-node fallback (still round-trips)', () => {
    const view = createView('x **a *b* c** y')
    caretInto(view, 'strong')
    // the whole strong span reveals as one source; parsing it yields multiple text
    // nodes, so the surgical path bails and dissolve falls back to a whole-node replace
    expect(findInlineSource(view.state)?.node.textContent).toBe('**a *b* c**')
    const revealed = serialize(view.state.doc)

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
    expect(findInlineSource(view.state)).toBeNull()
    expect(serialize(view.state.doc)).toBe(revealed)
  })

  it('serializes correctly even while a run is revealed', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    expect(findInlineSource(view.state)).not.toBeNull()
    expect(serialize(view.state.doc).trimEnd()).toBe('Hello **world**')
  })

  it('treats reveal and dissolve as transient (no non-transient doc change)', () => {
    const view = createView('Hello **world**')
    const run = firstMarkRun(view.state.doc, 'strong')
    const mid = Math.floor((run.from + run.to) / 2)
    view.focus()

    // Emulate index.tsx: a selection move into the run reveals, but only transient
    // transactions changed the doc → not a real content change.
    const { state, transactions } = view.state.applyTransaction(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, mid))
    )
    view.updateState(state)
    const realChange = transactions.some((t) => t.docChanged && !isTransientTransaction(t))
    expect(findInlineSource(view.state)).not.toBeNull()
    expect(realChange).toBe(false)
  })

  it('counts typing inside the revealed source as a real content change', () => {
    const view = createView('Hello **world**')
    caretInto(view, 'strong')
    const src = findInlineSource(view.state)!
    const at = src.pos + 3 // somewhere inside the source text

    const { state, transactions } = view.state.applyTransaction(view.state.tr.insertText('X', at))
    view.updateState(state)
    const realChange = transactions.some((t) => t.docChanged && !isTransientTransaction(t))
    expect(realChange).toBe(true)
  })
})

describe('inline_source serialization', () => {
  it('writes the node content verbatim without escaping', () => {
    const node = schema.nodes.inline_source.create(null, schema.text('**x**'))
    const doc = schema.nodes.doc.create(null, schema.nodes.paragraph.create(null, node))
    expect(serialize(doc).trimEnd()).toBe('**x**')
  })
})
