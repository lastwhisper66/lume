import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

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

export const syntaxRevealPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      blockDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
})
