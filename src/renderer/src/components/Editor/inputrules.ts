import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  ellipsis,
  InputRule
} from 'prosemirror-inputrules'
import { TextSelection } from 'prosemirror-state'
import type { Plugin } from 'prosemirror-state'
import type { MarkType, NodeType } from 'prosemirror-model'
import { schema } from './schema/gfm'

// "> " → blockquote
const blockQuoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)

// "---" / "***" / "___" (on their own line) → 分隔行
function horizontalRuleRule(nodeType: NodeType): InputRule {
  return new InputRule(/^(?:---|\*\*\*|___)$/, (state, _match, start, end) => {
    const $start = state.doc.resolve(start)
    // 仅当所在块是段落（避免 setext 标题下划线歧义与表格/代码块等场景）
    if ($start.parent.type.name !== 'paragraph') return null
    const index = $start.index(-1)
    if (!$start.node(-1).canReplaceWith(index, index, nodeType)) return null
    const tr = state.tr.insert(start - 1, nodeType.create())
    tr.delete(tr.mapping.map(start), tr.mapping.map(end))
    return tr
  })
}
const hrRule = horizontalRuleRule(schema.nodes.horizontal_rule)

// "--" → em dash（—），但不吃掉块首的 "--"（那是 "---" 分隔行的前两个字符）
const emDashRule = new InputRule(/--$/, (state, _match, start, end) => {
  if (state.doc.resolve(start).parentOffset === 0) return null
  return state.tr.insertText('—', start, end)
})

// "1. " → 有序列表
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + node.attrs.order === +match[1]
)

// "- " / "* " / "+ " → 无序列表
const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list)

// "``` " → 代码块
const codeBlockRule = textblockTypeInputRule(/^```$/, schema.nodes.code_block)

// "# " ~ "###### " → heading
const headingRule = textblockTypeInputRule(
  new RegExp('^(#{1,6})\\s$'),
  schema.nodes.heading,
  (match) => ({ level: match[1].length })
)

// "**x**" → strong
function markInputRule(regexp: RegExp, markType: MarkType): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const content = match[1]
    if (!content) return null
    const delimLen = (match[0].length - content.length) / 2
    const textStart = start + delimLen
    const textEnd = textStart + content.length
    const tr = state.tr
    if (textEnd < end) tr.delete(textEnd, end)
    if (textStart > start) tr.delete(start, textStart)
    const to = start + content.length
    tr.addMark(start, to, markType.create())
    tr.removeStoredMark(markType)
    return tr
  })
}

const strongRule = markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.strong)
const emRule = markInputRule(/(?<!\*)\*([^*]+)\*$/, schema.marks.em)
const codeRule = markInputRule(/`([^`]+)`$/, schema.marks.code)
const strikeRule = markInputRule(/~~([^~]+)~~$/, schema.marks.strikethrough)

// 「补起始符」成标记：markInputRule 只在「最后输入闭合符」时触发；当闭合符已在光标右侧
// （例如揭示态半程降级后残留的 `xxx` / xxx** / xxx*，用户重新补上前导分隔符），需要向右
// 看齐再成标记，否则文本会一直保持字面 Markdown、永不渲染。
//   openRegex：匹配「刚输入的起始分隔符」（textBefore 末尾）。
//   closeRegex：在光标右侧文本上匹配 `^内容+闭合符`，捕获组 1 为内容（不含分隔符字符）。
// 闭合规则优先于此，故本组规则须排在闭合规则之后，避免抢占「最后输入闭合符」的正常成标记。
function openMarkInputRule(openRegex: RegExp, closeRegex: RegExp, markType: MarkType): InputRule {
  return new InputRule(openRegex, (state, _match, start, end) => {
    const $end = state.doc.resolve(end)
    const after = state.doc.textBetween(end, $end.end())
    const close = closeRegex.exec(after)
    if (!close) return null
    const content = close[1]
    if (!content) return null
    const closeLen = close[0].length - content.length
    const contentTo = end + content.length
    const tr = state.tr
    tr.delete(contentTo, contentTo + closeLen) // 删右侧闭合符
    tr.addMark(end, contentTo, markType.create())
    if (end > start) tr.delete(start, end) // 删已落入文档的前导符（如 ** 的第一个 *）
    tr.removeStoredMark(markType)
    tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(end))) // 光标留在用户输入处
    return tr
  })
}

const strongOpenRule = openMarkInputRule(/\*\*$/, /^([^*]+)\*\*/, schema.marks.strong)
const emOpenRule = openMarkInputRule(/(?<!\*)\*$/, /^([^*]+)\*(?!\*)/, schema.marks.em)
const codeOpenRule = openMarkInputRule(/`$/, /^([^`]+)`/, schema.marks.code)
const strikeOpenRule = openMarkInputRule(/~~$/, /^([^~]+)~~/, schema.marks.strikethrough)

export function buildInputRules(): Plugin {
  return inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      hrRule,
      emDashRule,
      blockQuoteRule,
      orderedListRule,
      bulletListRule,
      codeBlockRule,
      headingRule,
      strongRule,
      emRule,
      codeRule,
      strikeRule,
      strongOpenRule,
      emOpenRule,
      codeOpenRule,
      strikeOpenRule
    ]
  })
}
