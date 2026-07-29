import {
  defaultMarkdownSerializer,
  MarkdownSerializer,
  MarkdownSerializerState
} from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'
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
    // 揭示态的行内片段：内容已是裸 Markdown 源码，原样写出（不转义），
    // 使得即便在揭示中途保存，输出的 Markdown 依然正确。
    inline_source(state, node) {
      state.text(node.textContent, false)
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
  return serializer.serialize(doc)
}

// 揭示态源码序列化：与 serialize 复用同一套 node/mark 处理器，但不转义行内分隔符
// （` * ~ _ [ ]）。用于「标题源码 textarea」这类把节点还原成可直接编辑的裸 Markdown 的
// 场景——若转义，删掉 `**x**` 的一个 `*` 得到的游离 `*` 会被写成 `\*`，破坏往返：用户再补
// 一个 `*` 也无法复原成 `**x**`。与行内 inline_source 的非转义约定一致。仅跳过行内分隔符
// 转义；行首块级标记（#、列表项、> 等）仍转义，避免正文里的行首符号被误当块级语法。
type RevealSerializerState = {
  out: string
  esc(str: string, startOfLine?: boolean): string
  renderContent(node: PMNode): void
}
type RevealSerializerStateCtor = new (
  nodes: MarkdownSerializer['nodes'],
  marks: MarkdownSerializer['marks'],
  options: Record<string, unknown>
) => RevealSerializerState
const SerializerState = MarkdownSerializerState as unknown as RevealSerializerStateCtor

function escapeBlockStartOnly(str: string, startOfLine: boolean): string {
  if (!startOfLine) return str
  return str
    .replace(/^(\+[ ]|[-*>])/, '\\$&')
    .replace(/^(\s*)(#{1,6})(\s|$)/, '$1\\$2$3')
    .replace(/^(\s*\d+)\.\s/, '$1\\. ')
}

export function serializeReveal(doc: PMNode): string {
  const state = new SerializerState(serializer.nodes, serializer.marks, {})
  state.esc = (str: string, startOfLine = false): string => escapeBlockStartOnly(str, startOfLine)
  state.renderContent(doc)
  return state.out
}
