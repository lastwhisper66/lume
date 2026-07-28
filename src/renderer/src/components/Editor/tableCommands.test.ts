import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { TableMap } from 'prosemirror-tables'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { schema } from './schema/gfm'
import {
  currentColumnAlign,
  deleteRowSafe,
  insertTable,
  moveColumn,
  moveRow,
  setColumnAlign
} from './tableCommands'

const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n')

function firstTablePos(state: EditorState): number {
  let pos = -1
  state.doc.descendants((node, p) => {
    if (pos === -1 && node.type.name === 'table') {
      pos = p
      return false
    }
    return undefined
  })
  if (pos === -1) throw new Error('no table')
  return pos
}

/** 在第 (row,col) 个单元格内放置光标 */
function caretInCell(state: EditorState, row: number, col: number): EditorState {
  const tablePos = firstTablePos(state)
  const table = state.doc.nodeAt(tablePos)!
  const map = TableMap.get(table)
  const cellPos = tablePos + 1 + map.map[row * map.width + col]
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cellPos + 1)))
}

function apply(state: EditorState, command: ReturnType<typeof moveRow>): EditorState {
  let next = state
  command(state, (tr) => {
    next = state.apply(tr)
  })
  return next
}

function stateOf(md: string): EditorState {
  return EditorState.create({ doc: parse(md), schema })
}

describe('setColumnAlign', () => {
  it('aligns an entire column and toggles off when reapplied', () => {
    let state = caretInCell(stateOf(TABLE), 1, 0)
    state = apply(state, setColumnAlign('center'))
    expect(serialize(state.doc).trimEnd()).toBe(
      ['| a | b |', '| :---: | --- |', '| 1 | 2 |', '| 3 | 4 |'].join('\n')
    )
    // 再次应用同一对齐 → 清除
    state = caretInCell(state, 1, 0)
    state = apply(state, setColumnAlign('center'))
    expect(serialize(state.doc).trimEnd()).toBe(TABLE)
  })

  it('reports the current column alignment', () => {
    let state = caretInCell(stateOf(TABLE), 0, 1)
    expect(currentColumnAlign(state)).toBeNull()
    state = apply(state, setColumnAlign('right'))
    state = caretInCell(state, 2, 1)
    expect(currentColumnAlign(state)).toBe('right')
  })
})

describe('moveRow', () => {
  it('swaps two body rows', () => {
    let state = caretInCell(stateOf(TABLE), 1, 0) // first body row (1,2)
    state = apply(state, moveRow(1))
    expect(serialize(state.doc).trimEnd()).toBe(
      ['| a | b |', '| --- | --- |', '| 3 | 4 |', '| 1 | 2 |'].join('\n')
    )
  })

  it('refuses to move the header row', () => {
    const state = caretInCell(stateOf(TABLE), 0, 0)
    expect(moveRow(1)(state, undefined)).toBe(false)
    expect(moveRow(-1)(state, undefined)).toBe(false)
  })

  it('refuses to move a body row up into the header slot', () => {
    const state = caretInCell(stateOf(TABLE), 1, 0)
    expect(moveRow(-1)(state, undefined)).toBe(false)
  })
})

describe('moveColumn', () => {
  it('swaps two columns across every row', () => {
    let state = caretInCell(stateOf(TABLE), 0, 0)
    state = apply(state, moveColumn(1))
    expect(serialize(state.doc).trimEnd()).toBe(
      ['| b | a |', '| --- | --- |', '| 2 | 1 |', '| 4 | 3 |'].join('\n')
    )
  })

  it('refuses to move the leftmost column left', () => {
    const state = caretInCell(stateOf(TABLE), 0, 0)
    expect(moveColumn(-1)(state, undefined)).toBe(false)
  })
})

describe('deleteRowSafe', () => {
  it('refuses to delete the GFM header row', () => {
    const state = caretInCell(stateOf(TABLE), 0, 0)
    expect(deleteRowSafe(state, undefined)).toBe(false)
  })

  it('deletes a body row', () => {
    let state = caretInCell(stateOf(TABLE), 1, 0)
    state = apply(state, deleteRowSafe)
    expect(serialize(state.doc).trimEnd()).toBe(
      ['| a | b |', '| --- | --- |', '| 3 | 4 |'].join('\n')
    )
  })
})

describe('insertTable', () => {
  it('inserts a table at an empty paragraph', () => {
    const state = EditorState.create({ doc: parse(''), schema })
    const next = apply(state, insertTable(2, 2))
    expect(serialize(next.doc).trimEnd()).toBe(
      ['|   |   |', '| --- | --- |', '|   |   |'].join('\n')
    )
  })

  it('refuses to insert a table inside an existing table', () => {
    const state = caretInCell(stateOf(TABLE), 0, 0)
    expect(insertTable(2, 2)(state, undefined)).toBe(false)
  })
})
