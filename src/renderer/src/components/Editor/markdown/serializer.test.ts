import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { serialize, serializeReveal } from './serializer'

describe('serializeReveal', () => {
  it('leaves a stray emphasis delimiter unescaped so the source round-trips', () => {
    // Deleting one `*` from `# **bold**` yields `em(bold)` + literal `*`.
    const doc = parse('# *bold**')

    // The default serializer escapes the stray `*` (correct on-disk Markdown)...
    expect(serialize(doc).trimEnd()).toBe('# *bold*\\*')
    // ...but the reveal serializer keeps it raw so the textarea shows editable source.
    expect(serializeReveal(doc).trimEnd()).toBe('# *bold**')
  })

  it('re-adding the removed delimiter reforms the nested format', () => {
    const degraded = parse('# *bold**')
    const revealed = serializeReveal(degraded).trimEnd()
    // User types the missing `*` back at the front of the body: `# **bold**`.
    const restored = parse(revealed.replace('# ', '# *'))
    const strong = restored.firstChild?.firstChild
    expect(strong?.marks.map((m) => m.type.name)).toEqual(['strong'])
    expect(strong?.text).toBe('bold')
  })

  it('does not escape strikethrough or code delimiters in revealed source', () => {
    expect(serializeReveal(parse('# ~~gone~')).trimEnd()).toBe('# ~~gone~')
    expect(serializeReveal(parse('# `code`')).trimEnd()).toBe('# `code`')
  })

  it('still escapes leading block markers so body text is not mistaken for a block', () => {
    // A paragraph whose text starts with `#` must keep the escape at line start.
    expect(serializeReveal(parse('\\# not a heading')).trimEnd()).toBe('\\# not a heading')
  })
})

describe('adjacent bullet lists', () => {
  /** 解析 → 序列化 → 再解析，返回顶层 block 的类型序列 */
  function blockTypes(md: string): string[] {
    const types: string[] = []
    parse(md).forEach((child) => types.push(child.type.name))
    return types
  }

  it('keeps two adjacent lists separate instead of merging them', () => {
    const doc = parse('- a\n- b\n\n* c\n* d\n')
    expect(doc.childCount).toBe(2)
    // 同 marker 会被 CommonMark 并成一个列表，所以第二段必须换 marker
    const out = serialize(doc)
    expect(blockTypes(out)).toEqual(['bullet_list', 'bullet_list'])
  })

  it('stays stable across repeated round-trips', () => {
    const md = '- a\n- b\n\n* c\n* d\n\n+ e\n+ f\n'
    const once = serialize(parse(md))
    const twice = serialize(parse(once))
    expect(twice).toBe(once)
    expect(blockTypes(once)).toEqual(['bullet_list', 'bullet_list', 'bullet_list'])
  })

  it('keeps adjacent lists tight rather than flipping them loose', () => {
    const out = serialize(parse('- a\n- b\n\n* c\n* d\n'))
    parse(out).forEach((list) => expect(list.attrs.tight).toBe(true))
  })

  it('does not alternate the marker for nested lists', () => {
    // 嵌套靠缩进区分，无需换 marker；前一个闭合块是父项的 paragraph 而非 bullet_list
    const out = serialize(parse('- a\n  - b\n  - c\n- d\n')).trimEnd()
    expect(out).toBe('- a\n  - b\n  - c\n- d')
  })

  it('alternates for a list following one that ends with a nested list', () => {
    const md = '- a\n  - b\n- c\n\n* d\n* e\n'
    const once = serialize(parse(md))
    expect(blockTypes(once)).toEqual(['bullet_list', 'bullet_list'])
    expect(serialize(parse(once))).toBe(once)
  })

  it('preserves an intentionally loose list', () => {
    const out = serialize(parse('- a\n\n- b\n'))
    expect(parse(out).firstChild!.attrs.tight).toBe(false)
    expect(serialize(parse(out))).toBe(out)
  })
})
