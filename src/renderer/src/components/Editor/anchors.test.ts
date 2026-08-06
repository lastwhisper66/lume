import { describe, expect, it } from 'vitest'
import { schema } from './schema/gfm'
import { slugify, resolveAnchor } from './anchors'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'

function docWithHeadings(...titles: [number, string][]): ReturnType<typeof schema.node> {
  const heads = titles.map(([level, text]) =>
    schema.node('heading', { level }, text ? [schema.text(text)] : [])
  )
  return schema.node('doc', null, heads)
}

describe('slugify', () => {
  it('lowercases, drops punctuation, joins with hyphens', () => {
    expect(slugify('1. Introduction')).toBe('1-introduction')
    expect(slugify('Hello, World!')).toBe('hello-world')
  })

  it('keeps CJK / Japanese and strips the middle dot like GitHub', () => {
    expect(slugify('6. 幾何計算・リスク判定・危険フレーム選定')).toBe(
      '6-幾何計算リスク判定危険フレーム選定'
    )
  })

  it('keeps underscores', () => {
    expect(slugify('foo_bar baz')).toBe('foo_bar-baz')
  })
})

describe('resolveAnchor', () => {
  it('matches a heading by its GitHub slug', () => {
    const doc = docWithHeadings(
      [1, 'Getting Started'],
      [2, '6. 幾何計算・リスク判定・危険フレーム選定']
    )
    const pos = resolveAnchor(doc, '#6-幾何計算リスク判定危険フレーム選定')
    expect(pos).not.toBeNull()
    // 命中的应是第二个标题
    expect(doc.nodeAt(pos!)?.textContent).toBe('6. 幾何計算・リスク判定・危険フレーム選定')
  })

  it('decodes a percent-encoded fragment before matching', () => {
    const doc = docWithHeadings([1, '幾何'])
    expect(resolveAnchor(doc, '#%E5%B9%BE%E4%BD%95')).not.toBeNull()
  })

  it('applies GitHub -1 / -2 suffixes for duplicate headings', () => {
    const doc = docWithHeadings([1, 'Notes'], [2, 'Notes'], [3, 'Notes'])
    const first = resolveAnchor(doc, '#notes')
    const second = resolveAnchor(doc, '#notes-1')
    const third = resolveAnchor(doc, '#notes-2')
    expect(first).toBe(0)
    expect(second).not.toBe(first)
    expect(third).not.toBe(second)
  })

  it('returns null for non-anchor hrefs and unknown slugs', () => {
    const doc = docWithHeadings([1, 'Title'])
    expect(resolveAnchor(doc, 'https://example.com')).toBeNull()
    expect(resolveAnchor(doc, '#does-not-exist')).toBeNull()
  })
})

describe('link URL decoding round-trip', () => {
  it('keeps non-ASCII anchor URLs readable through parse + serialize', () => {
    const md =
      '[6. 幾何計算・リスク判定・危険フレーム選定](#6-幾何計算リスク判定危険フレーム選定)\n'
    const out = serialize(parse(md))
    expect(out).toContain('(#6-幾何計算リスク判定危険フレーム選定)')
    expect(out).not.toContain('%E5%B9%BE')
  })
})
