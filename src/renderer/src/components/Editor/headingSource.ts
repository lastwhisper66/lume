import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'

export interface ParsedAtxHeading {
  level: number
  prefixLength: number
  body: string
}

export function parseAtxHeading(source: string): ParsedAtxHeading | null {
  const match = /^(#{1,6})[ \t]+(.*)$/.exec(source)
  if (!match) return null
  return {
    level: match[1].length,
    prefixLength: source.length - match[2].length,
    body: match[2]
  }
}

export function headingPrefix(level: number): string {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} `
}

function parseInternalHeadingPrefix(node: PMNode): ParsedAtxHeading | null {
  if (node.type.name !== 'heading') return null
  const parsed = parseAtxHeading(node.textContent)
  return parsed?.level === Number(node.attrs.level) ? parsed : null
}

export function headingPrefixLength(node: PMNode): number {
  return parseInternalHeadingPrefix(node)?.prefixLength ?? 0
}

export function headingBodyText(node: PMNode): string {
  if (node.type.name !== 'heading') return node.textContent
  return parseInternalHeadingPrefix(node)?.body ?? node.textContent
}

function mapDocument(node: PMNode, mapHeading: (heading: PMNode) => PMNode): PMNode {
  if (node.type.name === 'heading') return mapHeading(node)
  if (node.isLeaf) return node
  const children: PMNode[] = []
  node.forEach((child) => children.push(mapDocument(child, mapHeading)))
  return node.copy(Fragment.fromArray(children))
}

export function addHeadingPrefixes(doc: PMNode): PMNode {
  return mapDocument(doc, (heading) => {
    const prefix = heading.type.schema.text(headingPrefix(Number(heading.attrs.level)))
    return heading.copy(Fragment.from(prefix).append(heading.content))
  })
}

export function stripHeadingPrefixes(doc: PMNode): PMNode {
  return mapDocument(doc, (heading) => {
    const prefixLength = headingPrefixLength(heading)
    return prefixLength === 0 ? heading : heading.copy(heading.content.cut(prefixLength))
  })
}

export function documentBodyText(doc: PMNode | undefined, blockSeparator: string): string {
  if (!doc) return ''
  const cleanDoc = stripHeadingPrefixes(doc)
  return cleanDoc.textBetween(0, cleanDoc.content.size, blockSeparator)
}
