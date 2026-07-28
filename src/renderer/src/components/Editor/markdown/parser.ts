import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token.mjs'
import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema/gfm'

const md = MarkdownIt('default', { html: false, linkify: true })

function listIsTight(tokens: Token[], i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i].type !== 'list_item_open') return tokens[i].hidden
  }
  return false
}

/** 从 markdown-it 表格单元格 token 的 style="text-align:..." 读出对齐 */
function alignFromToken(tok: Token): 'left' | 'center' | 'right' | null {
  const style = tok.attrGet('style')
  if (!style) return null
  const m = /text-align:\s*(left|center|right)/.exec(style)
  return m ? (m[1] as 'left' | 'center' | 'right') : null
}

const parser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: {
    block: 'bullet_list',
    getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) })
  },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok, tokens, i) => ({
      order: +tok.attrGet('start')! || 1,
      tight: listIsTight(tokens, i)
    })
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: {
    block: 'code_block',
    getAttrs: (tok) => ({ params: tok.info || '' }),
    noCloseToken: true
  },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: (tok.children?.[0] && tok.children[0].content) || null
    })
  },
  hardbreak: { node: 'hard_break' },

  // GFM 表格
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header', getAttrs: (tok) => ({ align: alignFromToken(tok) }) },
  td: { block: 'table_cell', getAttrs: (tok) => ({ align: alignFromToken(tok) }) },

  // 标记
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strikethrough' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null })
  },
  code_inline: { mark: 'code', noCloseToken: true }
})

/** 把 list_item 首段以 [ ] / [x] 开头的项转成 checked 属性并剥离前缀 */
function stripPrefix(para: PMNode, n: number): PMNode {
  const first = para.firstChild
  if (!first || !first.isText) return para
  const newText = (first.text ?? '').slice(n)
  const kids: PMNode[] = []
  para.forEach((c, _off, idx) => {
    if (idx === 0) {
      if (newText) kids.push(c.type.schema.text(newText, c.marks))
    } else {
      kids.push(c)
    }
  })
  return para.copy(Fragment.fromArray(kids))
}

function applyTaskLists(node: PMNode): PMNode {
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(applyTaskLists(child)))
  let out = node.copy(Fragment.fromArray(kids))

  if (out.type.name === 'list_item') {
    const firstPara = out.firstChild
    const firstInline = firstPara?.firstChild
    if (firstPara?.type.name === 'paragraph' && firstInline?.isText) {
      const m = /^\[([ xX])\]\s/.exec(firstInline.text ?? '')
      if (m) {
        const checked = m[1] !== ' '
        const newFirst = stripPrefix(firstPara, m[0].length)
        const paraKids: PMNode[] = []
        out.forEach((c, _off, idx) => paraKids.push(idx === 0 ? newFirst : c))
        out = out.type.create({ ...out.attrs, checked }, Fragment.fromArray(paraKids), out.marks)
      }
    }
  }
  return out
}

export function parse(markdown: string): PMNode {
  const doc = parser.parse(markdown)
  if (!doc) throw new Error('Markdown 解析失败')
  return applyTaskLists(doc)
}
