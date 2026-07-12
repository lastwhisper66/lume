import { describe, expect, it } from 'vitest'
import { parse } from '../Editor/markdown/parser'
import { detectDocumentLanguage, documentText } from './languageDetection'

describe('documentText', () => {
  it('omits editable heading prefixes', () => {
    expect(documentText(parse('## Heading\n\nParagraph'))).toBe('Heading Paragraph')
  })

  it('preserves hashes that belong to paragraph content', () => {
    expect(documentText(parse('#Not a heading\n\nParagraph'))).toBe('#Not a heading Paragraph')
  })
})

describe('detectDocumentLanguage', () => {
  it('detects English', () => {
    expect(
      detectDocumentLanguage(
        'All human beings are born free and equal in dignity and rights. They are endowed with reason and conscience.'
      )
    ).toBe('en')
  })

  it('detects Mandarin Chinese', () => {
    expect(
      detectDocumentLanguage(
        '人人生而自由，在尊严和权利上一律平等。他们赋有理性和良心，并应以兄弟关系的精神相对待。'
      )
    ).toBe('zh')
  })

  it('detects Japanese', () => {
    expect(
      detectDocumentLanguage(
        'すべての人間は、生まれながらにして自由であり、かつ、尊厳と権利とについて平等である。'
      )
    ).toBe('ja')
  })

  it('rejects text that is too short', () => {
    expect(detectDocumentLanguage('hello')).toBeNull()
  })
})
