import { describe, expect, it } from 'vitest'
import { parse } from '../Editor/markdown/parser'
import { countWords, extractOutline } from './documentInfo'

describe('heading document metadata', () => {
  it('omits the editable ATX prefix from outline entries', () => {
    expect(extractOutline(parse('### Heading'))).toEqual([{ text: 'Heading', level: 3, pos: 0 }])
  })

  it('does not include a heading with an empty semantic body', () => {
    expect(extractOutline(parse('### '))).toEqual([])
  })

  it('does not count the editable heading prefix as content', () => {
    expect(countWords(parse('# One heading'))).toBe(2)
  })
})
