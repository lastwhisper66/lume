import { Fragment, type Node as PMNode } from 'prosemirror-model'
import { TextSelection, type Command, type EditorState } from 'prosemirror-state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable,
  selectedRect
} from 'prosemirror-tables'
import { schema } from './schema/gfm'
import type { Align } from './markdown/tables'

// 直接复用 prosemirror-tables 的内置命令（selection 感知）
export {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  isInTable
}

/** 当前列若各行对齐一致则返回该对齐，否则返回 null */
export function currentColumnAlign(state: EditorState): Align | null {
  if (!isInTable(state)) return null
  const { map, table, left } = selectedRect(state)
  let align: Align | null | undefined
  for (let row = 0; row < map.height; row++) {
    const cell = table.nodeAt(map.map[row * map.width + left])
    if (!cell) continue
    const a = (cell.attrs.align as Align) ?? null
    if (align === undefined) align = a
    else if (align !== a) return null
  }
  return align ?? null
}

/**
 * 把当前选区涉及的整列（所有行）设为某对齐。GFM 对齐是按列的，所以要覆盖每一行的
 * 单元格。若该列已是目标对齐，则清除对齐（toggle）。
 */
export function setColumnAlign(align: Align): Command {
  return (state, dispatch) => {
    if (!isInTable(state)) return false
    const rect = selectedRect(state)
    if (!dispatch) return true
    const next: Align | null = currentColumnAlign(state) === align ? null : align
    const { map, table, tableStart, left, right } = rect
    const tr = state.tr
    const seen = new Set<number>()
    for (let col = left; col < right; col++) {
      for (let row = 0; row < map.height; row++) {
        const cellPos = map.map[row * map.width + col]
        if (seen.has(cellPos)) continue
        seen.add(cellPos)
        const cell = table.nodeAt(cellPos)
        if (!cell) continue
        tr.setNodeMarkup(tableStart + cellPos, undefined, { ...cell.attrs, align: next })
      }
    }
    if (tr.docChanged) dispatch(tr)
    return true
  }
}

/** 返回当前选区所在 table 节点及其在文档中的位置 */
function tableContext(
  state: EditorState
): { table: PMNode; pos: number; tableStart: number } | null {
  if (!isInTable(state)) return null
  const { table, tableStart } = selectedRect(state)
  return { table, pos: tableStart - 1, tableStart }
}

/**
 * 上/下移动当前行（dir=-1 上、dir=1 下）。首行是 GFM 表头，不能被移动，也不能有正文行
 * 移动进入表头位置——保证表头恒为第一行。
 */
export function moveRow(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    const { table, pos } = ctx
    const { top, bottom } = selectedRect(state)
    const rowCount = table.childCount
    if (top === 0) return false // 表头行不可移动
    if (dir === -1 && top <= 1) return false // 不能移进表头位置
    if (dir === 1 && bottom >= rowCount) return false
    if (!dispatch) return true

    const rows: PMNode[] = []
    table.forEach((r) => rows.push(r))
    const block = rows.splice(top, bottom - top)
    rows.splice(dir === -1 ? top - 1 : top + 1, 0, ...block)
    const newTable = table.type.create(table.attrs, Fragment.fromArray(rows), table.marks)
    dispatch(state.tr.replaceWith(pos, pos + table.nodeSize, newTable).scrollIntoView())
    return true
  }
}

/** 左/右移动当前列（dir=-1 左、dir=1 右）。GFM 无跨列，逐行交换单元格即可。 */
export function moveColumn(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const ctx = tableContext(state)
    if (!ctx) return false
    const { table, pos } = ctx
    const { left, right, map } = selectedRect(state)
    if (dir === -1 && left === 0) return false
    if (dir === 1 && right >= map.width) return false
    if (!dispatch) return true

    const insertAt = dir === -1 ? left - 1 : left + 1
    const newRows: PMNode[] = []
    table.forEach((row) => {
      const cells: PMNode[] = []
      row.forEach((c) => cells.push(c))
      const block = cells.splice(left, right - left)
      cells.splice(insertAt, 0, ...block)
      newRows.push(row.type.create(row.attrs, Fragment.fromArray(cells), row.marks))
    })
    const newTable = table.type.create(table.attrs, Fragment.fromArray(newRows), table.marks)
    dispatch(state.tr.replaceWith(pos, pos + table.nodeSize, newTable).scrollIntoView())
    return true
  }
}

/** 构造一个 rows×cols 的空表格节点（首行 table_header，其余 table_cell） */
export function buildTable(rows: number, cols: number): PMNode {
  const headerCells: PMNode[] = []
  for (let c = 0; c < cols; c++) headerCells.push(schema.nodes.table_header.createAndFill()!)
  const out: PMNode[] = [schema.nodes.table_row.create(null, Fragment.fromArray(headerCells))]
  for (let r = 1; r < rows; r++) {
    const cells: PMNode[] = []
    for (let c = 0; c < cols; c++) cells.push(schema.nodes.table_cell.createAndFill()!)
    out.push(schema.nodes.table_row.create(null, Fragment.fromArray(cells)))
  }
  return schema.nodes.table.create(null, Fragment.fromArray(out))
}

/** 在光标处插入表格：空段落则替换，否则插到当前顶层块之后；光标落到首个单元格。 */
export function insertTable(rows = 3, cols = 3): Command {
  return (state, dispatch) => {
    const { $from } = state.selection
    if (isInTable(state)) return false // 不在表格里嵌套表格
    if (!dispatch) return true
    const table = buildTable(rows, cols)
    const topBlock = $from.node(1)
    const emptyPara =
      topBlock.type.name === 'paragraph' && topBlock.content.size === 0 && $from.depth === 1
    let tr = state.tr
    let tablePos: number
    if (emptyPara) {
      const start = $from.before(1)
      tr = tr.replaceWith(start, start + topBlock.nodeSize, table)
      tablePos = start
    } else {
      tablePos = $from.after(1)
      tr = tr.insert(tablePos, table)
    }
    // table(+1) → row(+1) → cell(+1) → 单元格内容起点
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(tablePos + 3)))
    dispatch(tr.scrollIntoView())
    return true
  }
}

/**
 * 光标在一个形如 `| a | b |` 的顶层段落末尾时按 Enter：把该段落转成一个以这些单元格为
 * 表头、外加一空正文行的表格。不匹配时返回 false，交回默认 Enter 行为。
 */
export const insertTableFromPipeRow: Command = (state, dispatch) => {
  const { $from, empty } = state.selection
  if (!empty || $from.depth !== 1) return false
  const para = $from.parent
  if (para.type.name !== 'paragraph') return false
  if ($from.parentOffset !== para.content.size) return false // 需在段末
  const m = /^\s*\|(.+)\|\s*$/.exec(para.textContent)
  if (!m) return false
  const labels = m[1].split('|').map((s) => s.trim())
  if (labels.length === 0) return false
  if (!dispatch) return true

  const headerCells = labels.map((txt) =>
    schema.nodes.table_header.create(null, txt ? schema.text(txt) : undefined)
  )
  const bodyCells: PMNode[] = []
  for (let c = 0; c < labels.length; c++) bodyCells.push(schema.nodes.table_cell.createAndFill()!)
  const table = schema.nodes.table.create(
    null,
    Fragment.fromArray([
      schema.nodes.table_row.create(null, Fragment.fromArray(headerCells)),
      schema.nodes.table_row.create(null, Fragment.fromArray(bodyCells))
    ])
  )
  const start = $from.before(1)
  const tr = state.tr.replaceWith(start, start + para.nodeSize, table)
  // 光标落到第二行（正文）首个单元格更顺手
  tr.setSelection(TextSelection.near(tr.doc.resolve(start + 3)))
  dispatch(tr.scrollIntoView())
  return true
}

/** 删除当前行，但拒绝删除 GFM 表头行（第 0 行恒为表头） */
export const deleteRowSafe: Command = (state, dispatch) => {
  if (!isInTable(state)) return false
  if (selectedRect(state).top === 0) return false
  return deleteRow(state, dispatch)
}

export type TableActionGroup = 'insert' | 'align' | 'move' | 'delete'

export interface TableAction {
  id: string
  label: string
  group: TableActionGroup
  command: Command
  /** 用于工具栏高亮（如当前列对齐） */
  isActive?: (state: EditorState) => boolean
}

/**
 * 表格操作的统一描述符，右键菜单与浮动工具栏共用（DRY）。分组顺序即展示顺序。
 */
export const TABLE_ACTIONS: TableAction[] = [
  { id: 'row-before', label: '在上方插入行', group: 'insert', command: addRowBefore },
  { id: 'row-after', label: '在下方插入行', group: 'insert', command: addRowAfter },
  { id: 'col-before', label: '在左侧插入列', group: 'insert', command: addColumnBefore },
  { id: 'col-after', label: '在右侧插入列', group: 'insert', command: addColumnAfter },
  {
    id: 'align-left',
    label: '左对齐',
    group: 'align',
    command: setColumnAlign('left'),
    isActive: (s) => currentColumnAlign(s) === 'left'
  },
  {
    id: 'align-center',
    label: '居中对齐',
    group: 'align',
    command: setColumnAlign('center'),
    isActive: (s) => currentColumnAlign(s) === 'center'
  },
  {
    id: 'align-right',
    label: '右对齐',
    group: 'align',
    command: setColumnAlign('right'),
    isActive: (s) => currentColumnAlign(s) === 'right'
  },
  { id: 'move-row-up', label: '上移行', group: 'move', command: moveRow(-1) },
  { id: 'move-row-down', label: '下移行', group: 'move', command: moveRow(1) },
  { id: 'move-col-left', label: '左移列', group: 'move', command: moveColumn(-1) },
  { id: 'move-col-right', label: '右移列', group: 'move', command: moveColumn(1) },
  { id: 'del-row', label: '删除行', group: 'delete', command: deleteRowSafe },
  { id: 'del-col', label: '删除列', group: 'delete', command: deleteColumn },
  { id: 'del-table', label: '删除表格', group: 'delete', command: deleteTable }
]
