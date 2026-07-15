import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

// 链接右边界（doc 位置 to）在视觉上同时是「链接文本末尾」和「整段链接之后」。
// 用 side 记录光标当前处于 URL 的哪一侧：
//   textEnd   → 光标在 URL 左侧（链接文本末尾）：揭示 `](url)`，→ 进 URL 开头
//   afterLink → 光标在 URL 右侧（整段链接之后）：收起揭示，光标落在链接之后，→ 越过链接
type LinkNavState = { pos: number; side: 'textEnd' | 'afterLink' } | null

const linkNavKey = new PluginKey<LinkNavState>('linkNav')

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

/** 把光标移入链接编辑区（默认停在末尾，atStart 时停在开头） */
export function focusLinkInput(input: HTMLElement, atStart = false): void {
  input.focus()
  const selection = window.getSelection()
  if (!selection) return
  const range = document.createRange()
  range.selectNodeContents(input)
  range.collapse(atStart)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 光标是否折叠在可编辑区最开头 */
function caretAtStart(el: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || !selection.focusNode) return false
  if (!el.contains(selection.focusNode)) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setEnd(selection.focusNode, selection.focusOffset)
  return range.toString().length === 0
}

/** 光标是否折叠在可编辑区最末尾 */
function caretAtEnd(el: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection || !selection.isCollapsed || !selection.focusNode) return false
  if (!el.contains(selection.focusNode)) return false
  const range = document.createRange()
  range.selectNodeContents(el)
  range.setStart(selection.focusNode, selection.focusOffset)
  return range.toString().length === 0
}

/** 生成 `](url "title")` 的可编辑闭合 widget：URL 与 title 都在内联可编辑区里改 */
function linkTargetWidget(
  from: number,
  to: number,
  target: LinkTarget
): (view: EditorView) => HTMLElement {
  return (view) => {
    const wrapper = document.createElement('span')
    wrapper.className = 'md-link-marker md-link-target'

    const open = document.createElement('span')
    open.className = 'md-link-punct'
    open.setAttribute('contenteditable', 'false')
    open.textContent = ']('
    wrapper.appendChild(open)

    // 用内联 contenteditable span 而非 <input>：为空时零宽度（没有占位空白），
    // 超长 URL 可随容器宽度逐字符软换行。
    const input = document.createElement('span')
    input.className = 'md-link-input'
    input.setAttribute('contenteditable', 'true')
    input.setAttribute('role', 'textbox')
    input.setAttribute('aria-label', '链接地址')
    input.setAttribute('spellcheck', 'false')
    input.textContent = linkTargetString(target.href, target.title)
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
      commitLinkTarget(view, from, to, input.textContent ?? '', target)
    }

    // 提交并把光标退回文档中链接末尾。skip=true 时记录该位置，
    // 提交并把光标退回文档中链接右边界。side 记录光标落在 URL 的哪一侧，
    // 供方向键插件判断下一步是进入 URL、越过链接还是退回链接文本。
    const leaveToDoc = (side: 'textEnd' | 'afterLink'): void => {
      commit()
      view.focus()
      const pos = Math.min(to, view.state.doc.content.size)
      const tr = view.state.tr
        .setSelection(TextSelection.create(view.state.doc, pos))
        .setMeta(linkNavKey, { pos, side })
      view.dispatch(tr)
    }

    // 屏蔽 mousedown/mouseup/click，避免 ProseMirror 改动选区、把焦点抢回编辑器。
    // 点在括号上时主动把光标移进编辑区；点在编辑区里则走原生定位光标。
    wrapper.addEventListener('mousedown', (event) => {
      event.stopPropagation()
      const clickTarget = event.target as Node
      if (clickTarget !== input && !input.contains(clickTarget)) {
        event.preventDefault()
        focusLinkInput(input, clickTarget === open)
      }
    })
    wrapper.addEventListener('mouseup', (event) => event.stopPropagation())
    wrapper.addEventListener('click', (event) => event.stopPropagation())
    input.addEventListener('blur', commit)
    input.addEventListener('keydown', (event) => {
      // 编辑 URL 时完全接管键盘：阻止冒泡，避免 ProseMirror 的方向键/选区处理
      // 把光标从编辑区里拽走（否则按 → 会被反复吸回开头）。
      event.stopPropagation()
      if (event.key === 'Enter') {
        event.preventDefault()
        leaveToDoc('afterLink')
      } else if (event.key === 'Escape') {
        event.preventDefault()
        committed = true
        input.textContent = linkTargetString(target.href, target.title)
        view.focus()
      } else if (event.key === 'ArrowLeft' && caretAtStart(input)) {
        // 已在开头再向左：退回链接文本末尾
        event.preventDefault()
        leaveToDoc('textEnd')
      } else if (event.key === 'ArrowRight' && caretAtEnd(input)) {
        // 已在末尾再向右：越过整段链接
        event.preventDefault()
        leaveToDoc('afterLink')
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
  const nav = linkNavKey.getState(state)

  let rangeStart: number | null = null
  let current: LinkTarget | null = null
  let pos = blockStart

  const flush = (to: number): void => {
    // 光标恰好停在链接右边界、且逻辑上位于 URL 右侧（afterLink）时，收起揭示：
    // 让链接渲染为普通文本，光标干净地落在整段链接之后，而不是被卡在 `](url)` 之前。
    const collapsedAfter =
      nav?.side === 'afterLink' && nav.pos === to && selFrom === to && selTo === to
    if (
      rangeStart !== null &&
      current !== null &&
      rangeStart <= selTo &&
      to >= selFrom &&
      !collapsedAfter
    ) {
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

/** pos 是否恰好是某个 link 的右边界（左侧有 link、右侧没有同一个 link） */
function isLinkRightBoundary(state: EditorState, pos: number): boolean {
  const linkType = state.schema.marks.link
  const $pos = state.doc.resolve(pos)
  const before = $pos.nodeBefore ? linkType.isInSet($pos.nodeBefore.marks) : undefined
  if (!before) return false
  const after = $pos.nodeAfter ? linkType.isInSet($pos.nodeAfter.marks) : undefined
  return !after || !after.eq(before)
}

/**
 * 纯方向键进出 URL 编辑区：
 * - 插件 state 跟踪光标在链接右边界处于 URL 的哪一侧（textEnd / afterLink），
 *   自然移动时按移动方向推断，程序化退出时由 widget 通过 meta 明确写入。
 * - textEnd 一侧揭示 `](url)`，→ 进入 URL；afterLink 一侧收起揭示，→ 直接越过链接。
 *   焦点已在 URL 编辑区时 view.hasFocus() 为假，直接放行，避免把光标反复吸回开头。
 */
export function linkNavPlugin(): Plugin<LinkNavState> {
  return new Plugin<LinkNavState>({
    key: linkNavKey,
    state: {
      init: () => null,
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(linkNavKey) as LinkNavState | undefined
        if (meta !== undefined) return meta
        const sel = newState.selection
        if (!(sel instanceof TextSelection) || !sel.empty) return null
        const pos = sel.from
        if (!isLinkRightBoundary(newState, pos)) return null
        const oldPos = oldState.selection.from
        if (oldPos < pos) return { pos, side: 'textEnd' }
        if (oldPos > pos) return { pos, side: 'afterLink' }
        return value && value.pos === pos ? value : { pos, side: 'textEnd' }
      }
    },
    props: {
      handleKeyDown(view, event) {
        // 只有「从链接文本末尾向右」进入 URL。afterLink 一侧揭示已收起、没有可进入的
        // 编辑区，直接放行默认行为让光标越过链接。
        if (event.key !== 'ArrowRight') return false
        if (!view.hasFocus()) return false // 焦点已在 URL 编辑区，交给它自己处理
        const sel = view.state.selection
        if (!(sel instanceof TextSelection) || !sel.empty) return false
        const nav = linkNavKey.getState(view.state)
        if (!nav || nav.pos !== sel.from || nav.side !== 'textEnd') return false
        const input = view.dom.querySelector<HTMLElement>('.md-link-input')
        if (!input) return false
        focusLinkInput(input, true)
        event.preventDefault()
        return true
      }
    }
  })
}

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
