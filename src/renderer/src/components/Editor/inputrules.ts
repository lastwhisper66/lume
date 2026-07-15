import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  ellipsis,
  InputRule
} from 'prosemirror-inputrules'
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
      strikeRule
    ]
  })
}
