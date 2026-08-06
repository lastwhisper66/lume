import { toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import { goToNextCell } from 'prosemirror-tables'
import type { Command } from 'prosemirror-state'
import { schema } from './schema/gfm'
import { insertTable, insertTableFromPipeRow } from './tableCommands'
import { listEnter, liftListItemCommand, sinkListItemCommand } from './listCommands'

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
  // 表格优先（形如 `| a | b |` 的段落转表格），不命中再走列表语义拆分；
  // 两者都返回 false 时落到 keymap(baseKeymap) 的通用 Enter 链。
  Enter: chainCommands(insertTableFromPipeRow, listEnter),
  // Tab 在表格里跳单元格、在列表里改缩进；都不命中则返回 false 保持默认
  // （不插入 Tab 字符——Markdown 文档里的字面制表符会破坏结构）。
  Tab: chainCommands(goToNextCell(1), sinkListItemCommand),
  'Shift-Tab': chainCommands(goToNextCell(-1), liftListItemCommand),
  'Mod-Alt-t': insertTable(),
  'Mod-Shift-1': setBlockType(schema.nodes.heading, { level: 1 }),
  'Mod-Shift-2': setBlockType(schema.nodes.heading, { level: 2 }),
  'Mod-Shift-0': setBlockType(schema.nodes.paragraph),
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
