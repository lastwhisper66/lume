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
  // 临时行内节点：光标进入某个行内标记片段时，该片段被替换为持有其原始
  // Markdown（如 `**x**`）的 inline_source 节点，光标离开后重新解析回标记。
  // 解析器永不产出它、序列化器按 textContent 原样输出它、揭示/收起事务对 dirty/撤销
  // 透明——详见 inlineSourceReveal.ts。
  //   内容形态：分隔符字符裸、inner 文本携带真实标记（如 `**` 裸 + `world`[strong] + `**`
  //   裸）。inner 带标记是「跨 dissolve 撤销无损」的关键：用户编辑记录进历史即带标记，撤销
  //   逆步重建时也带标记。故 marks 必须放开这几个目标标记（而非 ''）。
  //   code:true 让 inputRules 在其内部不触发（否则源码里打 `*` 会被输入规则误删）。
  .addToEnd('inline_source', {
    group: 'inline',
    inline: true,
    content: 'text*',
    marks: 'strong em code strikethrough',
    code: true,
    selectable: false,
    parseDOM: [{ tag: 'span.md-inline-source' }],
    toDOM() {
      return ['span', { class: 'md-inline-source', spellcheck: 'false' }, 0]
    }
  })

const marks = base.spec.marks.addToEnd('strikethrough', {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
  toDOM() {
    return ['s', 0]
  }
})

export const schema = new Schema({ nodes, marks })
