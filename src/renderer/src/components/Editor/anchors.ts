import type { Node as ProseMirrorNode } from 'prosemirror-model'

/**
 * GitHub 风格的标题 slug：小写化，删除「字母 / 数字 / 空白 / 连字符 / 下划线」以外的字符，
 * 再把空白转为连字符。CJK / 日文属于 Unicode 字母类，会被保留，与 GitHub 生成的锚点一致。
 * 例：`6. 幾何計算・リスク判定` → `6-幾何計算リスク判定`
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

function decodeFragment(fragment: string): string {
  try {
    return decodeURIComponent(fragment)
  } catch {
    return fragment
  }
}

/**
 * 把文档内锚点（`#slug`）解析为对应标题节点的文档位置；非锚点或找不到时返回 null。
 * 遵循 GitHub 对重复标题追加 `-1` / `-2` 的规则。
 */
export function resolveAnchor(doc: ProseMirrorNode, href: string): number | null {
  if (!href.startsWith('#')) return null
  const target = decodeFragment(href.slice(1)).toLowerCase()
  if (!target) return null

  const counts = new Map<string, number>()
  let found: number | null = null
  doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name !== 'heading') return true
    const base = slugify(node.textContent)
    const n = counts.get(base) ?? 0
    counts.set(base, n + 1)
    const slug = n === 0 ? base : `${base}-${n}`
    if (slug === target) found = pos
    return false
  })
  return found
}
