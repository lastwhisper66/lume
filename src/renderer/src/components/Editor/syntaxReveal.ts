import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

const INLINE_DELIMS: Record<string, string> = {
  strong: '**',
  em: '*',
  code: '`'
}

/** 生成一个灰色、不可编辑的语法符号 widget */
function markerWidget(text: string, extraClass = ''): (view: EditorView) => HTMLElement {
  return () => {
    const el = document.createElement('span')
    el.className = 'md-marker' + (extraClass ? ' ' + extraClass : '')
    el.textContent = text
    el.setAttribute('contenteditable', 'false')
    return el
  }
}

/** 块级揭示：heading 的 #、blockquote 的 >、code_block 的围栏 */
function blockDecorations(state: EditorState, decos: Decoration[]): void {
  const { $from } = state.selection
  const parent = $from.parent
  const start = $from.start()

  if (parent.type.name === 'heading') {
    const prefix = '#'.repeat(parent.attrs.level as number) + ' '
    decos.push(Decoration.widget(start, markerWidget(prefix), { side: -1, key: 'block-h' }))
  } else if (parent.type.name === 'code_block') {
    const params = (parent.attrs.params as string) || ''
    decos.push(
      Decoration.widget(start, markerWidget('```' + params, 'md-marker-block'), {
        side: -1,
        key: 'fence-open'
      })
    )
    decos.push(
      Decoration.widget($from.end(), markerWidget('```', 'md-marker-block'), {
        side: 1,
        key: 'fence-close'
      })
    )
  }

  // blockquote：向上查祖先，命中则在当前段落前显示 '> '
  for (let d = $from.depth; d > 0; d--) {
    if (state.selection.$from.node(d).type.name === 'blockquote') {
      decos.push(Decoration.widget(start, markerWidget('> '), { side: -1, key: 'block-bq' }))
      break
    }
  }
}

/** 行内揭示：光标所在文本块中，与选区相交的标记范围两侧显示分隔符 */
function inlineDecorations(state: EditorState, decos: Decoration[]): void {
  const { selection } = state
  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock) return

  const blockStart = $from.start()
  const selFrom = selection.from
  const selTo = selection.to

  for (const markName of Object.keys(INLINE_DELIMS)) {
    const delim = INLINE_DELIMS[markName]
    const ranges: Array<[number, number]> = []
    let rangeStart: number | null = null
    let pos = blockStart

    parent.forEach((child) => {
      const hasMark = child.marks.some((m) => m.type.name === markName)
      if (hasMark && rangeStart === null) {
        rangeStart = pos
      } else if (!hasMark && rangeStart !== null) {
        ranges.push([rangeStart, pos])
        rangeStart = null
      }
      pos += child.nodeSize
    })
    if (rangeStart !== null) ranges.push([rangeStart, pos])

    for (const [from, to] of ranges) {
      // 与选区相交（含光标贴边）才揭示
      if (from <= selTo && to >= selFrom) {
        decos.push(
          Decoration.widget(from, markerWidget(delim), { side: -1, key: `${markName}-o-${from}` })
        )
        decos.push(
          Decoration.widget(to, markerWidget(delim), { side: 1, key: `${markName}-c-${to}` })
        )
      }
    }
  }
}

export const syntaxRevealPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      blockDecorations(state, decos)
      inlineDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
})
