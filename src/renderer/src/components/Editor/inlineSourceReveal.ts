import { Fragment, Mark, Slice } from 'prosemirror-model'
import type { Node as PMNode, Schema } from 'prosemirror-model'
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state'
import type { EditorState, Transaction } from 'prosemirror-state'
import { ReplaceAroundStep } from 'prosemirror-transform'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { markTransient } from './transientEdits'

// 会被「揭示为源码」的行内标记。link 走 syntaxReveal.ts 里独立的可编辑 URL 机制，
// 故不在此列，且含 link 的文本不参与揭示，避免两套机制打架。
const TARGET_MARKS = ['strong', 'em', 'code', 'strikethrough']

const key = new PluginKey<InlineRevealState>('inlineSourceReveal')

// suppressAt：刚从源码节点「贴边退出」到的文档位置。揭示采用「贴边即揭示」
// （否则单字符标记如 `*a*` 永远无法揭示），这会和「退出」冲突——退出到边界又立刻
// 被重新揭示、弹不出去。故记录退出位置，光标停在该位置时不揭示；一旦移开即清除。
interface InlineRevealState {
  suppressAt: number | null
}

export interface RevealRun {
  from: number
  to: number
}

interface FoundSource {
  pos: number
  node: PMNode
}

/** 光标所在文本块内，与光标相邻/相交且带目标标记（且不含 link）的最大连续片段 */
export function findRevealRun(state: EditorState): RevealRun | null {
  const sel = state.selection
  if (!(sel instanceof TextSelection) || !sel.empty) return null
  const $pos = sel.$from
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  // heading 由 headingSource 整块揭示自己的源码，行内揭示不介入，避免两套机制打架。
  // （code_block 内文本无标记，天然不会命中；未来若新增块级源码揭示同样在此排除。）
  if (parent.type.name === 'heading') return null

  const p = sel.from
  let pos = $pos.start()
  let runStart: number | null = null
  const runs: RevealRun[] = []

  parent.forEach((child) => {
    const isTarget =
      child.isText &&
      !child.marks.some((m) => m.type.name === 'link') &&
      child.marks.some((m) => TARGET_MARKS.includes(m.type.name))
    if (isTarget && runStart === null) {
      runStart = pos
    } else if (!isTarget && runStart !== null) {
      runs.push({ from: runStart, to: pos })
      runStart = null
    }
    pos += child.nodeSize
  })
  if (runStart !== null) runs.push({ from: runStart, to: pos })

  // 贴边（from <= p <= to）即算命中，让单字符标记也能揭示。
  for (const run of runs) {
    if (run.from <= p && p <= run.to) return run
  }
  return null
}

/** 全文档里查找当前的 inline_source 节点（不变量：任一时刻至多一个） */
export function findInlineSource(state: EditorState): FoundSource | null {
  let found: FoundSource | null = null
  // TODO(perf): 每次事务全文档扫描；如遇超大文档可缩到选区所在块附近。
  state.doc.descendants((node, pos) => {
    if (found) return false
    if (node.type.name === 'inline_source') {
      found = { pos, node }
      return false
    }
    return undefined
  })
  return found
}

/** 把 [from,to) 的行内内容序列化为 Markdown 源码（如 `**world**`） */
function runToSource(state: EditorState, run: RevealRun): string {
  const { schema } = state
  const fragment = state.doc.slice(run.from, run.to).content
  const paragraph = schema.nodes.paragraph.create(null, fragment)
  const doc = schema.nodes.doc.create(null, paragraph)
  return serialize(doc).trimEnd()
}

/** 把源码字符串解析回行内内容；无法解析为单段落时退化为纯文本以免丢数据 */
function sourceToInline(state: EditorState, source: string): Fragment | PMNode {
  if (!source) return Fragment.empty
  const doc = parse(source)
  const first = doc.firstChild
  if (doc.childCount === 1 && first?.type.name === 'paragraph') {
    return first.content
  }
  return state.schema.text(source)
}

/** 计算揭示后光标应落在源码内部的哪个偏移（贴边落在源码两端，中间尽量对齐正文） */
export function revealCaretOffset(
  source: string,
  renderedText: string,
  renderedOffset: number
): number {
  if (renderedOffset <= 0) return 0
  if (renderedOffset >= renderedText.length) return source.length
  const inner = source.indexOf(renderedText)
  return inner >= 0 ? inner + renderedOffset : Math.min(renderedOffset, source.length)
}

/** run 覆盖的所有文本子节点若带同一组标记则返回它；嵌套/混合标记返回 null。 */
function uniformMarks(doc: PMNode, from: number, to: number): readonly Mark[] | null {
  let marks: readonly Mark[] | null = null
  let uniform = true
  let seen = false
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return
    seen = true
    if (!marks) marks = node.marks
    else if (!Mark.sameSet(marks, node.marks)) uniform = false
  })
  return seen && uniform ? marks : null
}

/** 构造揭示态节点内容 [lead 裸][inner 带 marks][trail 裸]（inner 即渲染文本、marks 即其标记）。 */
function buildRevealContent(
  schema: Schema,
  source: string,
  inner: string,
  marks: readonly Mark[],
  leadLen: number
): Fragment {
  const lead = source.slice(0, leadLen)
  const trail = source.slice(leadLen + inner.length)
  const kids: PMNode[] = []
  if (lead) kids.push(schema.text(lead))
  kids.push(schema.text(inner, marks))
  if (trail) kids.push(schema.text(trail))
  return Fragment.fromArray(kids)
}

/**
 * 揭示态节点内容：单标记情形 = 分隔符裸、inner 带真实标记（这样用户编辑记录进历史即带标记，
 * 撤销逆步重建也带标记 → 跨 dissolve 撤销无损）；嵌套/混合标记退化为全裸源码（收起走整节点回退）。
 */
function buildSourceContent(state: EditorState, run: RevealRun, source: string): Fragment {
  const { schema } = state
  const inner = state.doc.textBetween(run.from, run.to)
  const marks = uniformMarks(state.doc, run.from, run.to)
  const leadLen = source.indexOf(inner)
  if (marks && marks.length > 0 && inner.length > 0 && leadLen >= 0) {
    return buildRevealContent(schema, source, inner, marks, leadLen)
  }
  return Fragment.from(schema.text(source))
}

function revealTransaction(state: EditorState, run: RevealRun, caret: number): Transaction | null {
  const source = runToSource(state, run)
  if (!source) return null
  const { schema } = state
  const node = schema.nodes.inline_source.create(null, buildSourceContent(state, run, source))
  const tr = state.tr.replaceWith(run.from, run.to, node)

  const renderedText = state.doc.textBetween(run.from, run.to)
  const offset = revealCaretOffset(source, renderedText, caret - run.from)
  const caretPos = run.from + 1 + offset
  tr.setSelection(TextSelection.create(tr.doc, caretPos))
  tr.setMeta(key, { suppressAt: null })
  markTransient(tr)
  tr.setMeta('addToHistory', false)
  return tr
}

/**
 * 保标记收起：inner 文本在揭示态即携带真实标记，故收起时无需带外 `addMark`——只删首尾分隔符、
 * 再用 `ReplaceAroundStep` 把带标记的 inner 提升进段落。`ReplaceAroundStep`（`lift`/`wrap` 的
 * 底层）通过 gap 保留 inner 每个内部位置（仅平移、不坍缩），且 inner 的标记随文本一并保留，因此
 * 夹在「揭示 / 收起」两个 addToHistory:false 结构事务之间的真实编辑，其撤销逆步既能正确 rebase、
 * 重建出的文本也仍带标记 → 跨 dissolve 撤销无损（插入/删除/替换皆可）。
 *
 * 仅在「干净揭示形」下走此路：节点内容恰为 [lead 裸][inner 带 marks][trail 裸]（⟺ 用户只改了
 * inner 文本、未动分隔符）。改了分隔符（半程降级）、嵌套/混合标记等破坏该形的情形返回 `false`，
 * 交调用方回退整节点重解析替换——那一次跨 dissolve 撤销退化为无害 no-op（不损坏文档）。
 *
 * @returns 是否已在 `tr` 上完成收起；`false` 表示需要回退
 */
function applySurgicalDissolve(tr: Transaction, found: FoundSource): boolean {
  const source = found.node.textContent
  // 重解析源码，要求恰好是「单段落 · 单文本子节点」，据此得出 inner 文本与其标记。
  const doc = parse(source)
  const para = doc.firstChild
  if (doc.childCount !== 1 || para?.type.name !== 'paragraph' || para.childCount !== 1) return false
  const textNode = para.firstChild
  if (!textNode?.isText) return false
  const inner = textNode.text ?? '' // PM 文本节点非空，故 length >= 1
  const marks = textNode.marks
  const leadLen = source.indexOf(inner) // 前缀分隔符长度；indexOf 失败即复杂/嵌套
  if (leadLen < 0) return false
  const trailLen = source.length - leadLen - inner.length // 后缀分隔符长度
  if (trailLen < 0) return false

  // 干净揭示形检测：节点内容须与「据当前源码重建的 [lead 裸][inner 带 marks][trail 裸]」逐一相等。
  // 成立即 inner 已带正确标记，提升即无损；不成立（分隔符被改/标记涂抹）则回退。
  const schema = found.node.type.schema
  if (!found.node.content.eq(buildRevealContent(schema, source, inner, marks, leadLen)))
    return false

  const nodePos = found.pos
  const contentStart = nodePos + 1
  const contentEnd = contentStart + source.length
  // 先删尾、后删头：靠后的区间先删，前面的位置不受影响，头部区间仍从 contentStart 起。
  if (trailLen > 0) tr.delete(contentEnd - trailLen, contentEnd)
  if (leadLen > 0) tr.delete(contentStart, contentStart + leadLen)
  // 节点内容此刻 = 带标记的 inner，节点范围 [nodePos, nodeEnd)。ReplaceAroundStep 解壳：
  // 空切片替换首尾 token，gap = inner 内容，把它连同标记提升进父段落，位置保留、无带外加标记。
  const nodeEnd = nodePos + inner.length + 2
  tr.step(new ReplaceAroundStep(nodePos, nodeEnd, nodePos + 1, nodeEnd - 1, Slice.empty, 0, true))
  return true
}

// 可参与「重新组合」的行内分隔符字符（em/strong=*、code=`、strikethrough=~）。
const ABSORB_DELIMITERS = new Set(['*', '`', '~'])

/** [p, p+1) 处文本字符是否带任何标记（带标记的字符不属于「游离分隔符」，不吸收） */
function charHasMark(doc: PMNode, p: number): boolean {
  let marked = false
  doc.nodesBetween(p, p + 1, (node) => {
    if (node.isText && node.marks.length > 0) marked = true
  })
  return marked
}

/**
 * 回退重解析前，把紧贴节点两侧、同段落内「裸的分隔符字符」并入源码一起重解析。
 *
 * 场景：`**world**` 删一个 `*` 收起为 `em(world)` + 游离 `*`（markdown 忠实解析）；再进入
 * 该 em 揭示只覆盖 `world`（游离 `*` 在节点外），补一个 `*` 后节点是 `**world*`、游离 `*` 仍在
 * 节点外 → 单独重解析成 `*world*` 字面。把节点边界外相邻的裸分隔符一并纳入源码，`**world*` + `*`
 * = `**world**` 便能重新解析为 strong。仅吸收裸分隔符字符：若不能重组，重解析结果与原字面等价，无损。
 */
function absorbAdjacentDelimiters(
  state: EditorState,
  from: number,
  to: number,
  source: string
): { from: number; to: number; source: string } {
  const { doc } = state
  const blockStart = doc.resolve(from).start()
  const blockEnd = doc.resolve(to).end()
  let left = from
  while (left > blockStart) {
    const ch = doc.textBetween(left - 1, left)
    if (!ABSORB_DELIMITERS.has(ch) || charHasMark(doc, left - 1)) break
    left--
  }
  let right = to
  while (right < blockEnd) {
    const ch = doc.textBetween(right, right + 1)
    if (!ABSORB_DELIMITERS.has(ch) || charHasMark(doc, right)) break
    right++
  }
  if (left === from && right === to) return { from, to, source }
  return {
    from: left,
    to: right,
    source: doc.textBetween(left, from) + source + doc.textBetween(to, right)
  }
}

function dissolveTransaction(
  state: EditorState,
  found: FoundSource,
  opts?: { suppressAtCaret?: boolean }
): Transaction {
  const from = found.pos
  const to = found.pos + found.node.nodeSize
  const tr = state.tr

  // 保标记收起（干净揭示形 → 跨 dissolve 撤销无损）；分隔符被改/嵌套等情形回退整节点重解析
  // 替换（那一次跨 dissolve 撤销为无害 no-op，见 applySurgicalDissolve）。
  if (!applySurgicalDissolve(tr, found)) {
    const merged = absorbAdjacentDelimiters(state, from, to, found.node.textContent)
    tr.replaceWith(merged.from, merged.to, sourceToInline(state, merged.source))
  }

  // 光标此刻已在节点外（正因如此才收起），用 mapping 平移选区两端即可；范围选区
  // 也随之保留，不会坍缩成光标。
  const mapped = tr.mapping.map(state.selection.from, -1)
  const mappedTo = tr.mapping.map(state.selection.to, 1)
  tr.setSelection(TextSelection.create(tr.doc, mapped, mappedTo))

  // 抑制重新揭示：
  //  - suppressAtCaret（失焦收起）：光标仍落在刚渲染的片段内，必须抑制，否则会被
  //    立刻重新揭示、失焦态又露出源码。
  //  - 否则仅「贴边退出」（光标恰在节点左右边界）时抑制，跳到别处则放行。
  const caret = state.selection.from
  const adjacentExit = state.selection.empty && (caret === from || caret === to)
  const suppressAt = opts?.suppressAtCaret || adjacentExit ? mapped : null
  tr.setMeta(key, { suppressAt })
  markTransient(tr)
  tr.setMeta('addToHistory', false)
  return tr
}

/**
 * 选区驱动的行内源码揭示（Approach C：临时 inline_source 节点）：
 * - 光标进入带标记的片段 → 替换为持有其 Markdown 源码的 inline_source 节点；分隔符字符裸、
 *   inner 文本携带真实标记（strong/em/…），增删/选中/半程降级全走原生编辑，光标离开时收起。
 * - 每个 appendTransaction 周期至多做一次揭示或收起；返回的事务再次触发本钩子，直到到达稳定态
 *   （返回 null），因此逻辑保持单步、幂等。
 *
 * 撤销正确性：inner 在揭示态即带标记，故用户编辑记录进历史时带标记、其逆步重建时也带标记；收起
 * 用「删分隔符 + ReplaceAroundStep 提升」保留 inner 每个内部位置（不坍缩），于是「先离开、再撤销」
 * 也能正确还原（插入/删除/替换均可）。唯一例外：改动分隔符（如删一个 `*` 半程降级）会落到整节点
 * 回退分支，那一次跨 dissolve 撤销退化为无害 no-op（不损坏文档）。揭示态内直接撤销始终无损。
 */
export function inlineSourceRevealPlugin(): Plugin<InlineRevealState> {
  return new Plugin<InlineRevealState>({
    key,
    state: {
      init: () => ({ suppressAt: null }),
      apply(tr, value, _oldState, newState) {
        const meta = tr.getMeta(key) as InlineRevealState | undefined
        if (meta !== undefined) return meta
        if (value.suppressAt !== null) {
          const sel = newState.selection
          if (!sel.empty || sel.from !== value.suppressAt) return { suppressAt: null }
        }
        return value
      }
    },
    props: {
      // 编辑器失焦时收起当前源码，避免未聚焦状态下露出裸 Markdown（与 .md-marker
      // 失焦隐藏的既有行为一致）。延迟并复查焦点，避免内部可编辑区短暂夺焦时误收起。
      handleDOMEvents: {
        blur: (view) => {
          if (!findInlineSource(view.state)) return false
          queueMicrotask(() => {
            if (view.isDestroyed || view.hasFocus()) return
            const existing = findInlineSource(view.state)
            if (existing) {
              view.dispatch(dissolveTransaction(view.state, existing, { suppressAtCaret: true }))
            }
          })
          return false
        }
      }
    },
    appendTransaction(trs, oldState, newState) {
      const docChanged = trs.some((tr) => tr.docChanged)
      const selChanged = !oldState.selection.eq(newState.selection)
      if (!docChanged && !selChanged) return null

      const existing = findInlineSource(newState)
      const sel = newState.selection
      if (existing) {
        const start = existing.pos
        const end = existing.pos + existing.node.nodeSize
        // 选区仍严格落在源码节点内部 → 维持揭示（含在其中选择符号）。
        if (sel.from > start && sel.to < end) return null
        return dissolveTransaction(newState, existing)
      }

      if (!(sel instanceof TextSelection) || !sel.empty) return null
      const { suppressAt } = key.getState(newState) ?? { suppressAt: null }
      if (suppressAt !== null && sel.from === suppressAt) return null
      const run = findRevealRun(newState)
      if (!run) return null
      return revealTransaction(newState, run, sel.from)
    }
  })
}
