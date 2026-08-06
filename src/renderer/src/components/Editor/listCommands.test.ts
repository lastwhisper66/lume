import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Command } from 'prosemirror-state'
import { goToNextCell, TableMap } from 'prosemirror-tables'
import { chainCommands } from 'prosemirror-commands'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import { schema } from './schema/gfm'
import { listEnter, liftListItemCommand, sinkListItemCommand } from './listCommands'

function stateOf(md: string): EditorState {
  return EditorState.create({ doc: parse(md), schema })
}

/** 把光标放到第 n 个（0 基）list_item 的首段末尾 */
function caretInItem(state: EditorState, n: number): EditorState {
  let seen = 0
  let pos = -1
  state.doc.descendants((node, p) => {
    if (node.type.name === 'list_item') {
      if (seen === n && pos === -1) {
        const para = node.firstChild
        // +1 进 list_item，+1 进 paragraph，再加段落内容长度 = 段末
        pos = p + 2 + (para ? para.content.size : 0)
      }
      seen++
    }
    return undefined
  })
  if (pos === -1) throw new Error(`no list_item #${n}`)
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))
}

function apply(state: EditorState, command: Command): EditorState {
  let next = state
  command(state, (tr) => {
    next = state.apply(tr)
  })
  return next
}

/** 命令是否声明「我能处理」（不实际派发） */
function handles(state: EditorState, command: Command): boolean {
  return command(state, undefined)
}

const tabCommand = chainCommands(goToNextCell(1), sinkListItemCommand)

describe('listEnter 拆分列表项', () => {
  it('在普通列表项末尾回车，新增一个普通项', () => {
    const state = apply(caretInItem(stateOf('- a\n- b'), 0), listEnter)
    // 空列表项序列化为 `- `（marker 后有个空格）
    expect(serialize(state.doc).trim()).toBe('- a\n- \n- b')
  })

  it('在任务项末尾回车，新项是未勾选的任务项', () => {
    const state = apply(caretInItem(stateOf('- [x] done'), 0), listEnter)
    expect(serialize(state.doc).trim()).toBe('- [x] done\n- [ ]')
  })

  it('未勾选的任务项回车后新项仍是未勾选任务项', () => {
    const state = apply(caretInItem(stateOf('- [ ] todo'), 0), listEnter)
    expect(serialize(state.doc).trim()).toBe('- [ ] todo\n- [ ]')
  })

  it('已勾选任务项在行中拆分：原项保留 [x]，新项重置为 [ ]', () => {
    // splitListItem 的 itemAttrs 只在行末拆分时生效，行中拆分需额外重置新项
    let state = stateOf('- [x] abcdef')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))
    expect(serialize(apply(state, listEnter).doc).trim()).toBe('- [x] ab\n- [ ] cdef')
  })

  it('普通项行中拆分后两项都保持普通项', () => {
    let state = stateOf('- abcdef')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))
    expect(serialize(apply(state, listEnter).doc).trim()).toBe('- ab\n- cdef')
  })

  it('顶层空列表项回车退出列表，变成普通段落', () => {
    const state = apply(caretInItem(stateOf('- a\n-'), 1), listEnter)
    expect(state.doc.lastChild!.type.name).toBe('paragraph')
    expect(serialize(state.doc).trim()).toBe('- a')
  })

  it('嵌套列表的空项回车提升一级，仍在列表内', () => {
    const state = apply(caretInItem(stateOf('- a\n  - b\n  -'), 2), listEnter)
    // 空项被提升到外层列表：顶层仍是单个 bullet_list，且末项直接挂在它下面
    const list = state.doc.firstChild!
    expect(state.doc.childCount).toBe(1)
    expect(list.type.name).toBe('bullet_list')
    expect(list.lastChild!.type.name).toBe('list_item')
    expect(list.lastChild!.textContent).toBe('')
    expect(serialize(state.doc)).toContain('  - b')
  })

  it('光标不在列表里时返回 false，交回默认 Enter', () => {
    expect(handles(stateOf('普通段落'), listEnter)).toBe(false)
  })
})

describe('Tab / Shift-Tab 调整层级', () => {
  it('Tab 把第二项缩进为子列表', () => {
    const state = apply(caretInItem(stateOf('- a\n- b'), 1), sinkListItemCommand)
    expect(serialize(state.doc).trim()).toBe('- a\n  - b')
  })

  it('首项无法缩进（没有可挂靠的前一项）', () => {
    expect(handles(caretInItem(stateOf('- a\n- b'), 0), sinkListItemCommand)).toBe(false)
  })

  it('Shift-Tab 把子项提升回一级', () => {
    const state = apply(caretInItem(stateOf('- a\n  - b'), 1), liftListItemCommand)
    expect(serialize(state.doc).trim()).toBe('- a\n- b')
  })

  it('Shift-Tab 在顶层项上把它提升出列表', () => {
    const state = apply(caretInItem(stateOf('- a'), 0), liftListItemCommand)
    expect(state.doc.firstChild!.type.name).toBe('paragraph')
  })

  it('缩进保留任务项的勾选态', () => {
    const state = apply(caretInItem(stateOf('- a\n- [x] b'), 1), sinkListItemCommand)
    expect(serialize(state.doc).trim()).toBe('- a\n  - [x] b')
  })
})

describe('Tab 串联：表格与列表互不干扰', () => {
  const TABLE = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')

  function caretInCell(state: EditorState, row: number, col: number): EditorState {
    let tablePos = -1
    state.doc.descendants((node, p) => {
      if (tablePos === -1 && node.type.name === 'table') {
        tablePos = p
        return false
      }
      return undefined
    })
    const table = state.doc.nodeAt(tablePos)!
    const map = TableMap.get(table)
    const cellPos = tablePos + 1 + map.map[row * map.width + col]
    return state.apply(state.tr.setSelection(TextSelection.create(state.doc, cellPos + 1)))
  }

  it('表格里 Tab 仍然跳到下一个单元格', () => {
    const state = caretInCell(stateOf(TABLE), 0, 0)
    const next = apply(state, tabCommand)
    expect(next.selection.from).toBeGreaterThan(state.selection.from)
    expect(serialize(next.doc)).toBe(serialize(state.doc)) // 只移动光标，不改文档
  })

  it('列表里 Tab 走缩进而非跳单元格', () => {
    const state = apply(caretInItem(stateOf('- a\n- b'), 1), tabCommand)
    expect(serialize(state.doc).trim()).toBe('- a\n  - b')
  })

  it('既不在表格也不在列表时 Tab 返回 false', () => {
    expect(handles(stateOf('普通段落'), tabCommand)).toBe(false)
  })
})
