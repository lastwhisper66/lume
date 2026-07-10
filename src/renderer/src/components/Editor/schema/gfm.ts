import { schema as base } from 'prosemirror-markdown'
import { Schema } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

// GFM 表格：单元格只含 inline 内容（Markdown 表格单元格是单行）
const tNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {}
})

// 给 list_item 增加 checked 属性（null 普通项 / true|false 勾选态）
const baseListItem = base.spec.nodes.get('list_item')
if (!baseListItem) throw new Error('base schema 缺少 list_item')

const nodes = base.spec.nodes
  .update('list_item', {
    ...baseListItem,
    attrs: { ...(baseListItem.attrs ?? {}), checked: { default: null } },
    toDOM(node: import('prosemirror-model').Node) {
      const checked = node.attrs.checked
      if (checked === null) return ['li', 0]
      return ['li', { 'data-checked': checked ? 'true' : 'false' }, 0]
    }
  })
  // tableNodes 返回的 map 与 OrderedMap<NodeSpec>.append 的泛型不完全一致，用 as any 兜底
  .append(tNodes as never)

const marks = base.spec.marks.addToEnd('strikethrough', {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
  toDOM() {
    return ['s', 0]
  }
})

export const schema = new Schema({ nodes, marks })
