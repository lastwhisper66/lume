import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

export type Align = 'left' | 'center' | 'right'

/** 各对齐对应的 GFM 分隔行片段 */
const DELIMITER: Record<Align | 'none', string> = {
  none: '---',
  left: ':---',
  center: ':---:',
  right: '---:'
}

const INLINE: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  code: ['`', '`'],
  strikethrough: ['~~', '~~']
}

/** 将单元格 inline 内容渲染为一行 Markdown（转义竖线） */
function serializeCell(state: MarkdownSerializerState, cell: PMNode): string {
  let out = ''
  cell.forEach((child) => {
    if (!child.isText) return
    let text = state.esc(child.text ?? '').replace(/\|/g, '\\|')
    for (const mark of child.marks) {
      const d = INLINE[mark.type.name]
      if (d) text = d[0] + text + d[1]
    }
    const link = child.marks.find((m) => m.type.name === 'link')
    if (link) text = `[${text}](${link.attrs.href})`
    out += text
  })
  return out
}

export function serializeTable(state: MarkdownSerializerState, node: PMNode): void {
  const rows: string[][] = []
  const aligns: (Align | null)[] = []
  node.forEach((row, _rowOffset, rowIndex) => {
    const cells: string[] = []
    row.forEach((cell, _cellOffset, cellIndex) => {
      cells.push(serializeCell(state, cell))
      // 对齐是按列的：以表头行（第 0 行）单元格的 align 为准
      if (rowIndex === 0) aligns[cellIndex] = (cell.attrs.align as Align) ?? null
    })
    rows.push(cells)
  })
  if (rows.length === 0) return

  const colCount = rows[0].length
  const line = (cells: string[]): string => '| ' + cells.map((c) => c || ' ').join(' | ') + ' |'
  const delimiters: string[] = []
  for (let c = 0; c < colCount; c++) delimiters.push(DELIMITER[aligns[c] ?? 'none'])

  state.write(line(rows[0]) + '\n')
  state.write('| ' + delimiters.join(' | ') + ' |\n')
  for (let i = 1; i < rows.length; i++) state.write(line(rows[i]) + '\n')
  state.closeBlock(node)
}
