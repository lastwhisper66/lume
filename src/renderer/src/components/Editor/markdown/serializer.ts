import { defaultMarkdownSerializer, MarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'
import { stripHeadingPrefixes } from '../headingSource'
import { serializeTable } from './tables'

export const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    list_item(state, node) {
      const checked = node.attrs.checked
      if (checked !== null && checked !== undefined) {
        state.write(checked ? '[x] ' : '[ ] ')
      }
      state.renderContent(node)
    },
    table: serializeTable,
    // 表格由 serializeTable 整体处理，行/单元格不会被单独递归，提供 no-op 兜底
    table_row() {
      /* no-op: 由 serializeTable 处理 */
    },
    table_cell() {
      /* no-op: 由 serializeTable 处理 */
    },
    table_header() {
      /* no-op: 由 serializeTable 处理 */
    }
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true }
  }
)

export function serialize(doc: PMNode): string {
  return serializer.serialize(stripHeadingPrefixes(doc))
}
