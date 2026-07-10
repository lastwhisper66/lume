import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis,
  InputRule
} from 'prosemirror-inputrules'
import type { Plugin } from 'prosemirror-state'
import type { MarkType } from 'prosemirror-model'
import { schema } from './schema/gfm'

// "> " → blockquote
const blockQuoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)

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

export function buildInputRules(): Plugin {
  return inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      emDash,
      blockQuoteRule,
      orderedListRule,
      bulletListRule,
      codeBlockRule,
      headingRule,
      strongRule,
      emRule,
      codeRule
    ]
  })
}
