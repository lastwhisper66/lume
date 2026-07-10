import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

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
  node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(serializeCell(state, cell)))
    rows.push(cells)
  })
  if (rows.length === 0) return

  const colCount = rows[0].length
  const line = (cells: string[]): string => '| ' + cells.map((c) => c || ' ').join(' | ') + ' |'

  state.write(line(rows[0]) + '\n')
  state.write('| ' + Array(colCount).fill('---').join(' | ') + ' |\n')
  for (let i = 1; i < rows.length; i++) state.write(line(rows[i]) + '\n')
  state.closeBlock(node)
}
