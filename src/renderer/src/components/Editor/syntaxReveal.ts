import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import { headingPrefixLength } from './headingSource'

const INLINE_DELIMS: Record<string, string> = {
  strong: '**',
  em: '*',
  code: '`',
  strikethrough: '~~'
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

function headingDecorations(state: EditorState, decos: Decoration[]): void {
  const { $from } = state.selection
  let activeHeadingPos: number | null = null

  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.node(depth).type.name === 'heading') {
      activeHeadingPos = $from.before(depth)
      break
    }
  }

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true

    const prefixLength = headingPrefixLength(node)
    if (prefixLength > 0) {
      decos.push(
        Decoration.inline(pos + 1, pos + 1 + prefixLength, {
          class: 'heading-source-marker'
        })
      )
    }
    if (pos === activeHeadingPos) {
      decos.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: 'heading-source-active'
        })
      )
    }
    return false
  })
}

/** 块级揭示：heading 的 #、blockquote 的 >、code_block 的围栏 */
function blockDecorations(state: EditorState, decos: Decoration[]): void {
  const { $from } = state.selection
  const start = $from.start()

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

function linkDecorations(state: EditorState, decos: Decoration[]): void {
  const { selection } = state
  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock) return

  const blockStart = $from.start()
  const selFrom = selection.from
  const selTo = selection.to

  let rangeStart: number | null = null
  let href = ''
  let pos = blockStart

  const flush = (to: number): void => {
    if (rangeStart === null) return
    if (rangeStart <= selTo && to >= selFrom) {
      decos.push(
        Decoration.widget(rangeStart, markerWidget('['), { side: -1, key: `link-o-${rangeStart}` })
      )
      decos.push(
        Decoration.widget(to, markerWidget(`](${href})`), { side: 1, key: `link-c-${to}` })
      )
    }
    rangeStart = null
    href = ''
  }

  parent.forEach((child) => {
    const link = child.marks.find((m) => m.type.name === 'link')
    const childHref = link ? (link.attrs.href as string) || '' : null
    if (link && rangeStart === null) {
      rangeStart = pos
      href = childHref as string
    } else if (link && rangeStart !== null && childHref !== href) {
      // 相邻但 href 不同：结束上一个链接范围，开启新的
      flush(pos)
      rangeStart = pos
      href = childHref as string
    } else if (!link && rangeStart !== null) {
      flush(pos)
    }
    pos += child.nodeSize
  })
  flush(pos)
}

export const syntaxRevealPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      headingDecorations(state, decos)
      blockDecorations(state, decos)
      inlineDecorations(state, decos)
      linkDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
})
