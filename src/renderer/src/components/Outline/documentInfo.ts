import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { documentBodyText, headingBodyText } from '../Editor/headingSource'

export interface OutlineEntry {
  text: string
  level: number
  pos: number
}

export function extractOutline(doc: ProseMirrorNode | undefined): OutlineEntry[] {
  if (!doc) return []

  const outline: OutlineEntry[] = []

  doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true

    const text = headingBodyText(node).trim()
    if (text) {
      outline.push({
        text,
        level: Number(node.attrs.level),
        pos
      })
    }

    return false
  })

  return outline
}

export function countWords(doc: ProseMirrorNode | undefined): number {
  if (!doc) return 0

  const text = documentBodyText(doc, ' ')
  const words = text.match(
    /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]|[A-Za-z0-9]+(?:['’_-][A-Za-z0-9]+)*/g
  )

  return words?.length ?? 0
}
