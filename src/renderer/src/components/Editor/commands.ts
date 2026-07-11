import { toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import type { Command } from 'prosemirror-state'
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

function isAtHeadingStart(state: Parameters<Command>[0]): boolean {
  const { selection } = state
  return (
    selection.empty &&
    selection.$from.parent.type === schema.nodes.heading &&
    selection.$from.parentOffset === 0
  )
}

export const lowerHeadingLevel: Command = (state, dispatch) => {
  if (!isAtHeadingStart(state)) return false
  const level = state.selection.$from.parent.attrs.level as number
  const command =
    level > 1
      ? setBlockType(schema.nodes.heading, { level: level - 1 })
      : setBlockType(schema.nodes.paragraph)
  return command(state, dispatch)
}

export const keepHeadingCaretAtStart: Command = (state) => isAtHeadingStart(state)

export const keymapBindings: Record<string, Command> = {
  Backspace: lowerHeadingLevel,
  ArrowLeft: keepHeadingCaretAtStart,
  'Mod-b': toggleStrong,
  'Mod-i': toggleEm,
  'Mod-`': toggleCode,
  'Mod-Shift-x': toggleStrikethrough,
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': insertHardBreak,
  'Mod-Shift-1': setBlockType(schema.nodes.heading, { level: 1 }),
  'Mod-Shift-2': setBlockType(schema.nodes.heading, { level: 2 }),
  'Mod-Shift-0': setBlockType(schema.nodes.paragraph),
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
