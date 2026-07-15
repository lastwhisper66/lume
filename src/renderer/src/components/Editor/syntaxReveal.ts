import { Plugin, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

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

interface LinkTarget {
  href: string
  title: string | null
}

/** 由 href + title 构造 `](...)` 中显示/编辑的目标串 */
export function linkTargetString(href: string, title: string | null): string {
  if (title) return `${href} "${title.replace(/"/g, '\\"')}"`
  return href
}

/** 解析 `dest "title"` 目标串为 href / title */
export function parseLinkTarget(raw: string): LinkTarget {
  let rest = raw.trim()
  let href = ''
  if (rest.startsWith('<')) {
    const end = rest.indexOf('>')
    if (end >= 0) {
      href = rest.slice(1, end)
      rest = rest.slice(end + 1).trim()
    } else {
      href = rest.slice(1)
      rest = ''
    }
  } else {
    const match = /^\S+/.exec(rest)
    href = match ? match[0] : ''
    rest = match ? rest.slice(match[0].length).trim() : ''
  }
  let title: string | null = null
  const titleMatch = /^"((?:[^"\\]|\\.)*)"$|^'((?:[^'\\]|\\.)*)'$|^\(([^)]*)\)$/.exec(rest)
  if (titleMatch) {
    title = (titleMatch[1] ?? titleMatch[2] ?? titleMatch[3] ?? '').replace(/\\(.)/g, '$1')
  } else if (rest) {
    title = rest
  }
  return { href, title: title || null }
}

/** 把编辑后的目标串写回文档中 [from, to) 范围的 link 标记；空 href 则解除链接 */
function commitLinkTarget(
  view: EditorView,
  from: number,
  to: number,
  rawValue: string,
  original: LinkTarget
): void {
  const linkType = view.state.schema.marks.link
  const parsed = parseLinkTarget(rawValue)
  if (parsed.href === original.href && parsed.title === original.title) return
  const tr = view.state.tr.removeMark(from, to, linkType)
  if (parsed.href) {
    tr.addMark(from, to, linkType.create({ href: parsed.href, title: parsed.title }))
  }
  view.dispatch(tr)
}

/** 链接起始的 `[` 标记（与闭合 widget 用同一套类，避免失焦时被隐藏） */
function linkOpenWidget(): (view: EditorView) => HTMLElement {
  return () => {
    const el = document.createElement('span')
    el.className = 'md-link-marker md-link-punct'
    el.setAttribute('contenteditable', 'false')
    el.textContent = '['
    return el
  }
}

/** 生成 `](url "title")` 的可编辑闭合 widget：URL 与 title 都在内联输入框里改 */
function linkTargetWidget(
  from: number,
  to: number,
  target: LinkTarget
): (view: EditorView) => HTMLElement {
  return (view) => {
    const wrapper = document.createElement('span')
    wrapper.className = 'md-link-marker md-link-target'

    // 括号是纯装饰、不进文档：设为不可编辑，但不要把整个 wrapper 变成
    // contenteditable=false 的“孤岛”，否则里面的 <input> 无法获得焦点。
    const open = document.createElement('span')
    open.className = 'md-link-punct'
    open.setAttribute('contenteditable', 'false')
    open.textContent = ']('
    wrapper.appendChild(open)

    const input = document.createElement('input')
    input.className = 'md-link-input'
    input.setAttribute('aria-label', '链接地址')
    input.setAttribute('spellcheck', 'false')
    input.value = linkTargetString(target.href, target.title)
    input.size = Math.max(1, input.value.length)
    wrapper.appendChild(input)

    const close = document.createElement('span')
    close.className = 'md-link-punct'
    close.setAttribute('contenteditable', 'false')
    close.textContent = ')'
    wrapper.appendChild(close)

    let committed = false
    const commit = (): void => {
      if (committed) return
      committed = true
      commitLinkTarget(view, from, to, input.value, target)
    }

    input.addEventListener('input', () => {
      input.size = Math.max(1, input.value.length)
    })
    // 屏蔽 mousedown/mouseup/click，避免 ProseMirror 改动选区、把焦点抢回编辑器。
    // 点在括号上时主动把焦点移进输入框；点在输入框上则走原生定位光标。
    wrapper.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      if (event.target !== input) {
        event.preventDefault()
        input.focus()
      }
    })
    wrapper.addEventListener('mouseup', (event) => event.stopPropagation())
    wrapper.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
        view.focus()
        const pos = Math.min(to, view.state.doc.content.size)
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)))
      } else if (event.key === 'Escape') {
        event.preventDefault()
        committed = true
        input.value = linkTargetString(target.href, target.title)
        view.focus()
      }
    })
    return wrapper
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
  let current: LinkTarget | null = null
  let pos = blockStart

  const flush = (to: number): void => {
    if (rangeStart !== null && current !== null && rangeStart <= selTo && to >= selFrom) {
      decos.push(
        Decoration.widget(rangeStart, linkOpenWidget(), {
          side: -1,
          key: `link-o-${rangeStart}`
        })
      )
      decos.push(Decoration.widget(to, linkTargetWidget(rangeStart, to, current), { side: 1 }))
    }
    rangeStart = null
    current = null
  }

  parent.forEach((child) => {
    const link = child.marks.find((m) => m.type.name === 'link')
    if (link) {
      const attrs: LinkTarget = {
        href: (link.attrs.href as string) || '',
        title: (link.attrs.title as string | null) ?? null
      }
      if (rangeStart === null) {
        rangeStart = pos
        current = attrs
      } else if (current && (current.href !== attrs.href || current.title !== attrs.title)) {
        // 相邻但目标不同：结束上一个链接范围，开启新的
        flush(pos)
        rangeStart = pos
        current = attrs
      }
    } else if (rangeStart !== null) {
      flush(pos)
    }
    pos += child.nodeSize
  })
  flush(pos)
}

/** Ctrl / Cmd + 点击链接时在系统浏览器打开 */
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
      window.open(href, '_blank')
      return true
    }
  }
})

export const syntaxRevealPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      blockDecorations(state, decos)
      inlineDecorations(state, decos)
      linkDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
})
