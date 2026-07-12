import type { Node as PMNode } from 'prosemirror-model'
import { Plugin, PluginKey, Selection } from 'prosemirror-state'
import { parseAtxHeading } from './headingSource'

export const headingNormalizationKey = new PluginKey('headingNormalization')

interface Normalization {
  pos: number
  replacement: PMNode | null
  prefixLength: number
}

function prefixHasMarks(node: PMNode, prefixLength: number): boolean {
  let hasMarks = false
  node.nodesBetween(0, prefixLength, (child) => {
    if (child.isText && child.marks.length > 0) hasMarks = true
    return !hasMarks
  })
  return hasMarks
}

export const headingNormalizationPlugin = new Plugin({
  key: headingNormalizationKey,
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null
    if (transactions.some((tr) => tr.getMeta(headingNormalizationKey))) return null

    const normalizations: Normalization[] = []
    newState.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading' && node.type.name !== 'paragraph') return true

      const parsed = parseAtxHeading(node.textContent)
      let replacement: PMNode | null = null

      if (node.type.name === 'heading' && !parsed) {
        replacement = newState.schema.nodes.paragraph.create(null, node.content, node.marks)
      } else if (parsed && (node.type.name !== 'heading' || node.attrs.level !== parsed.level)) {
        replacement = newState.schema.nodes.heading.create(
          { level: parsed.level },
          node.content,
          node.marks
        )
      }

      const prefixLength = parsed?.prefixLength ?? 0
      if (replacement || (prefixLength > 0 && prefixHasMarks(node, prefixLength))) {
        normalizations.push({ pos, replacement, prefixLength })
      }
      return false
    })

    if (normalizations.length === 0) return null

    const selection = newState.selection.toJSON()
    const tr = newState.tr.setMeta(headingNormalizationKey, true)
    normalizations.sort((a, b) => b.pos - a.pos)

    for (const normalization of normalizations) {
      const current = tr.doc.nodeAt(normalization.pos)
      if (!current) continue
      if (normalization.replacement) {
        tr.replaceWith(
          normalization.pos,
          normalization.pos + current.nodeSize,
          normalization.replacement
        )
      }
      if (normalization.prefixLength > 0) {
        tr.removeMark(
          normalization.pos + 1,
          normalization.pos + 1 + normalization.prefixLength,
          null
        )
      }
    }

    tr.setSelection(Selection.fromJSON(tr.doc, selection))
    return tr
  }
})
