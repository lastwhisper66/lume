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
