import { toggleMark, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { closeHistory, undo, redo } from 'prosemirror-history'
import { TextSelection } from 'prosemirror-state'
import type { Command, EditorState, Transaction } from 'prosemirror-state'
import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'
import { headingPrefix, headingPrefixLength } from './headingSource'
import { schema } from './schema/gfm'

export const toggleStrong: Command = toggleMark(schema.marks.strong)
export const toggleEm: Command = toggleMark(schema.marks.em)
export const toggleCode: Command = toggleMark(schema.marks.code)
export const toggleStrikethrough: Command = toggleMark(schema.marks.strikethrough)

const hardBreak = schema.nodes.hard_break
const insertHardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }
  return true
})

function selectedTextblock(
  state: EditorState
): { node: PMNode; pos: number; anchor: number; head: number } | null {
  const { $anchor, $head } = state.selection
  if (!$anchor.sameParent($head)) return null
  const node = $anchor.parent
  if (node.type !== schema.nodes.paragraph && node.type !== schema.nodes.heading) return null
  return { node, pos: $anchor.before(), anchor: $anchor.parentOffset, head: $head.parentOffset }
}

function bodyOffset(offset: number, prefixLength: number, bodySize: number): number {
  return Math.min(bodySize, Math.max(0, offset - prefixLength))
}

function replaceTextblock(
  state: EditorState,
  tr: Transaction,
  type: typeof schema.nodes.paragraph,
  attrs: Record<string, unknown> | null,
  content: Fragment,
  oldPrefixLength: number,
  newPrefixLength: number
): Transaction {
  const selected = selectedTextblock(state)
  if (!selected) return tr
  const bodySize = selected.node.content.size - oldPrefixLength
  const anchor = bodyOffset(selected.anchor, oldPrefixLength, bodySize)
  const head = bodyOffset(selected.head, oldPrefixLength, bodySize)
  const replacement = type.create(attrs, content, selected.node.marks)

  tr.replaceWith(selected.pos, selected.pos + selected.node.nodeSize, replacement)
  const contentStart = selected.pos + 1 + newPrefixLength
  return tr.setSelection(TextSelection.create(tr.doc, contentStart + anchor, contentStart + head))
}

export function setHeadingLevel(level: number): Command {
  return (state, dispatch) => {
    const selected = selectedTextblock(state)
    if (!selected) return false
    const oldPrefixLength = headingPrefixLength(selected.node)
    const body = selected.node.content.cut(oldPrefixLength)
    const prefixText = headingPrefix(level)
    const content = Fragment.from(schema.text(prefixText)).append(body)

    if (dispatch) {
      const tr = replaceTextblock(
        state,
        state.tr,
        schema.nodes.heading,
        { level },
        content,
        oldPrefixLength,
        prefixText.length
      )
      dispatch(tr.scrollIntoView())
    }
    return true
  }
}

export const setParagraph: Command = (state, dispatch) => {
  const selected = selectedTextblock(state)
  if (!selected || selected.node.type !== schema.nodes.heading) return false
  const prefixLength = headingPrefixLength(selected.node)
  const content = selected.node.content.cut(prefixLength)

  if (dispatch) {
    const tr = replaceTextblock(
      state,
      state.tr,
      schema.nodes.paragraph,
      null,
      content,
      prefixLength,
      0
    )
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const splitHeading: Command = (state, dispatch) => {
  const { $from, $to } = state.selection
  if (!$from.sameParent($to) || $from.parent.type !== schema.nodes.heading) return false

  const heading = $from.parent
  const prefixLength = headingPrefixLength(heading)
  const fromOffset = Math.max(prefixLength, $from.parentOffset)
  const toOffset = Math.max(prefixLength, $to.parentOffset)
  const headingContent = heading.content.cut(0, fromOffset)
  const paragraphContent = heading.content.cut(toOffset)

  if (dispatch) {
    const headingPos = $from.before()
    const left = heading.type.create(heading.attrs, headingContent, heading.marks)
    const right = schema.nodes.paragraph.create(null, paragraphContent)
    const tr = closeHistory(
      state.tr.replaceWith(
        headingPos,
        headingPos + heading.nodeSize,
        Fragment.fromArray([left, right])
      )
    )
    tr.setSelection(TextSelection.create(tr.doc, headingPos + left.nodeSize + 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const keymapBindings: Record<string, Command> = {
  'Mod-b': toggleStrong,
  'Mod-i': toggleEm,
  'Mod-`': toggleCode,
  'Mod-Shift-x': toggleStrikethrough,
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': insertHardBreak,
  Enter: splitHeading,
  'Mod-Shift-1': setHeadingLevel(1),
  'Mod-Shift-2': setHeadingLevel(2),
  'Mod-Shift-0': setParagraph,
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
