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

// code 不在此表：反引号内部不做反斜杠转义，单独在 serializeCell 里处理
const INLINE: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  strikethrough: ['~~', '~~']
}

/**
 * 把行内代码包成反引号。反引号内部不处理反斜杠转义，所以内容必须原样写出——
 * 若走 state.esc()，`~~` 会被写成 `\~\~`，再次解析得到字面反斜杠，每存一次多一层。
 * 围栏长度取比内容中最长反引号串多 1；内容以反引号开头/结尾时补空格（CommonMark 会剥掉）。
 */
function wrapCode(text: string): string {
  let longest = 0
  for (const run of text.match(/`+/g) ?? []) longest = Math.max(longest, run.length)
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return fence + pad + text + pad + fence
}

/** 将单元格 inline 内容渲染为一行 Markdown（转义竖线） */
function serializeCell(state: MarkdownSerializerState, cell: PMNode): string {
  let out = ''
  cell.forEach((child) => {
    if (!child.isText) return
    const raw = child.text ?? ''
    const isCode = child.marks.some((m) => m.type.name === 'code')
    // 竖线在 GFM 表格里即使位于反引号内也必须转义，否则会被当成列分隔符
    let text = isCode ? wrapCode(raw.replace(/\|/g, '\\|')) : state.esc(raw).replace(/\|/g, '\\|')
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
