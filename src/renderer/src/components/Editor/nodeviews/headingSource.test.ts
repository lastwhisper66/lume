import { describe, expect, it } from 'vitest'
import { nearestTextOffset, parseHeadingSource } from './headingSource'

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

describe('nearestTextOffset', () => {
  const measure = (text: string): number => text.length * 10

  it.each([
    [-5, 0],
    [0, 0],
    [4, 0],
    [6, 1],
    [25, 3],
    [100, 4]
  ])('maps x=%s to offset %s', (x, offset) => {
    expect(nearestTextOffset('####', x, measure)).toBe(offset)
  })
})
