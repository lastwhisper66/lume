import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'
import { scrollEditorTo } from '../Outline/editorScroll'
import { resolveAnchor } from './anchors'

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
  const start = $from.start()

  // blockquote：向上查祖先，命中则在当前段落前显示 '> '
  for (let d = $from.depth; d > 0; d--) {
    if (state.selection.$from.node(d).type.name === 'blockquote') {
      decos.push(Decoration.widget(start, markerWidget('> '), { side: -1, key: 'block-bq' }))
      break
    }
  }
}

/**
 * 行内揭示（含链接的 `[text](url)` 源码）已由 inlineSourceReveal.ts 的可编辑 inline_source
 * 节点统一接管，此处不再注入任何 link widget。链接仅保留 Ctrl/Cmd 点击跳转与手型光标提示。
 */

/** Ctrl / Cmd + 点击链接：文档内锚点（#slug）滚动定位，其余在系统浏览器打开 */
export const linkClickPlugin = new Plugin({
  props: {
    handleClick(view, pos, event) {
      if (!(event.ctrlKey || event.metaKey)) return false
      const linkType = view.state.schema.marks.link
      const node = view.state.doc.nodeAt(pos)
      const mark = node ? linkType.isInSet(node.marks) : null
      const href = mark?.attrs.href as string | undefined
      if (!href) return false
      event.preventDefault()
      if (href.startsWith('#')) {
        const target = resolveAnchor(view.state.doc, href)
        if (target !== null) scrollEditorTo(target)
        return true
      }
      window.open(href, '_blank')
      return true
    }
  }
})

/**
 * 按住 Ctrl / Cmd 时给编辑器 DOM 加一个类，配合 CSS 把链接光标变成手型，
 * 提示用户可点击跳转 / 打开。松开或窗口失焦时移除。
 */
export function modKeyCursorPlugin(): Plugin {
  return new Plugin({
    view(editorView) {
      const dom = editorView.dom
      const sync = (event: KeyboardEvent): void => {
        dom.classList.toggle('lume-mod-active', event.ctrlKey || event.metaKey)
      }
      const clear = (): void => dom.classList.remove('lume-mod-active')
      window.addEventListener('keydown', sync)
      window.addEventListener('keyup', sync)
      window.addEventListener('blur', clear)
      return {
        destroy() {
          window.removeEventListener('keydown', sync)
          window.removeEventListener('keyup', sync)
          window.removeEventListener('blur', clear)
          clear()
        }
      }
    }
  })
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
