import { toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { goToNextCell } from 'prosemirror-tables'
import type { Command } from 'prosemirror-state'
import { schema } from './schema/gfm'
import { insertTable, insertTableFromPipeRow } from './tableCommands'

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

export const keymapBindings: Record<string, Command> = {
  'Mod-b': toggleStrong,
  'Mod-i': toggleEm,
  'Mod-`': toggleCode,
  'Mod-Shift-x': toggleStrikethrough,
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': insertHardBreak,
  Enter: insertTableFromPipeRow,
  Tab: goToNextCell(1),
  'Shift-Tab': goToNextCell(-1),
  'Mod-Alt-t': insertTable(),
  'Mod-Shift-1': setBlockType(schema.nodes.heading, { level: 1 }),
  'Mod-Shift-2': setBlockType(schema.nodes.heading, { level: 2 }),
  'Mod-Shift-0': setBlockType(schema.nodes.paragraph),
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
