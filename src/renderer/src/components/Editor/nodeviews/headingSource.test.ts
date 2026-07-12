// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { parseHeadingSource, sourceCaretOffset, splitHeadingSource } from './headingSource'

describe('parseHeadingSource', () => {
  it.each([
    ['# Title', 1, 'Title'],
    ['### Title', 3, 'Title'],
    ['###### Title #2', 6, 'Title #2']
  ])('parses %s as a heading', (source, level, text) => {
    expect(parseHeadingSource(source)).toEqual({ level, text })
  })

  it.each(['Title', '####### Title', '', '#NoSpace'])('treats %j as paragraph source', (source) => {
    expect(parseHeadingSource(source)).toEqual({ level: null, text: source })
  })
})

describe('sourceCaretOffset', () => {
  it('places the source caret after the heading prefix at the clicked text offset', () => {
    expect(sourceCaretOffset(4, 5, 20)).toBe(9)
  })

  it('clamps the caret to the available source', () => {
    expect(sourceCaretOffset(4, 20, 12)).toBe(12)
  })
})

describe('splitHeadingSource', () => {
  it.each([
    ['# BeforeAfter', 8, 8, { headingSource: '# Before', paragraphSource: 'After' }],
    ['## Before middle after', 9, 17, { headingSource: '## Before', paragraphSource: 'after' }],
    ['### Title', 0, 0, { headingSource: '### ', paragraphSource: 'Title' }],
    ['# Title', 7, 7, { headingSource: '# Title', paragraphSource: '' }]
  ])('splits %j from selection %d-%d', (source, selectionStart, selectionEnd, expected) => {
    expect(splitHeadingSource(source, selectionStart, selectionEnd)).toEqual(expected)
  })
})
