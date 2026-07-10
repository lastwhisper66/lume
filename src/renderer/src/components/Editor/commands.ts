import { toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import type { Command } from 'prosemirror-state'
import { schema } from './schema/gfm'

export const toggleStrong: Command = toggleMark(schema.marks.strong)
export const toggleEm: Command = toggleMark(schema.marks.em)
export const toggleCode: Command = toggleMark(schema.marks.code)

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
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': insertHardBreak,
  'Mod-Shift-1': setBlockType(schema.nodes.heading, { level: 1 }),
  'Mod-Shift-2': setBlockType(schema.nodes.heading, { level: 2 }),
  'Mod-Shift-0': setBlockType(schema.nodes.paragraph),
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
