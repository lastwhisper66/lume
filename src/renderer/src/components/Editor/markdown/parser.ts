import { defaultMarkdownParser } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

// P1：CommonMark。P4 会替换为基于 GFM 版 markdown-it 的自建 MarkdownParser。
export function parse(markdown: string): PMNode {
  const doc = defaultMarkdownParser.parse(markdown)
  if (!doc) throw new Error('Markdown 解析失败')
  return doc
}
