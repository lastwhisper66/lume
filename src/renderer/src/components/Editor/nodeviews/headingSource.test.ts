import { describe, expect, it } from 'vitest'
import { parseHeadingSource } from './headingSource'

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
