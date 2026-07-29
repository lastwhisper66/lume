// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import type { Node as PMNode } from 'prosemirror-model'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { schema } from './schema/gfm'
import { buildInputRules } from './inputrules'

/** 只装 inputRules 插件的编辑器，避免揭示插件把成标记后的结果转成 inline_source 干扰断言 */
function viewWithText(text: string, caret: number): EditorView {
  const doc = schema.node('doc', null, [
    schema.node('paragraph', null, text ? [schema.text(text)] : [])
  ])
  const state = EditorState.create({ doc, schema, plugins: [buildInputRules()] })
  const view = new EditorView(document.createElement('div'), { state })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, caret)))
  return view
}

/** 模拟逐字符输入：命中输入规则则由规则处理，否则按普通字符插入 */
function type(view: EditorView, text: string): void {
  for (const ch of text) {
    const { from, to } = view.state.selection
    const handled = view.someProp('handleTextInput', (f) =>
      f(view, from, to, ch, () => view.state.tr)
    )
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to))
  }
}

/** 首个带指定标记的文本节点文本；无则 null */
function firstMarkText(doc: PMNode, markName: string): string | null {
  let text: string | null = null
  doc.descendants((node) => {
    if (text !== null) return false
    if (node.isText && node.marks.some((m) => m.type.name === markName)) {
      text = node.text ?? ''
      return false
    }
    return undefined
  })
  return text
}

describe('补起始分隔符成标记（闭合符已在光标右侧）', () => {
  it('在 xxx` 前补 ` → code 标记，去掉两侧分隔符', () => {
    const view = viewWithText('xxx`', 1) // 光标在 x 前
    type(view, '`')
    expect(view.state.doc.textContent).toBe('xxx')
    expect(firstMarkText(view.state.doc, 'code')).toBe('xxx')
  })

  it('在 xxx* 前补 * → em 标记', () => {
    const view = viewWithText('xxx*', 1)
    type(view, '*')
    expect(view.state.doc.textContent).toBe('xxx')
    expect(firstMarkText(view.state.doc, 'em')).toBe('xxx')
  })

  it('在 xxx** 前补 ** → strong 标记（两次输入）', () => {
    const view = viewWithText('xxx**', 1)
    type(view, '**')
    expect(view.state.doc.textContent).toBe('xxx')
    expect(firstMarkText(view.state.doc, 'strong')).toBe('xxx')
  })

  it('在 xxx~~ 前补 ~~ → strikethrough 标记（两次输入）', () => {
    const view = viewWithText('xxx~~', 1)
    type(view, '~~')
    expect(view.state.doc.textContent).toBe('xxx')
    expect(firstMarkText(view.state.doc, 'strikethrough')).toBe('xxx')
  })

  it('右侧没有闭合符时不成标记，起始符按字面插入', () => {
    const view = viewWithText('xxx', 1)
    type(view, '`')
    expect(view.state.doc.textContent).toBe('`xxx')
    expect(firstMarkText(view.state.doc, 'code')).toBeNull()
  })

  it('单个 * 前只有 ** 闭合时不误判为 em', () => {
    const view = viewWithText('xxx**', 1)
    type(view, '*') // 仅输入一个 *，右侧是 **，不应成 em
    expect(view.state.doc.textContent).toBe('*xxx**')
    expect(firstMarkText(view.state.doc, 'em')).toBeNull()
  })

  it('末尾输入闭合符的正常成标记路径仍有效', () => {
    const view = viewWithText('`code', 6) // 光标在末尾
    type(view, '`')
    expect(view.state.doc.textContent).toBe('code')
    expect(firstMarkText(view.state.doc, 'code')).toBe('code')
  })
})
