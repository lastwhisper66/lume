import { defaultMarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

// P1：CommonMark。P4 会替换为含表格/任务列表/删除线的自建 MarkdownSerializer。
export function serialize(doc: PMNode): string {
  return defaultMarkdownSerializer.serialize(doc)
}
