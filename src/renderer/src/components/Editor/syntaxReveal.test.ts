import { describe, expect, it } from 'vitest'
import { headingMarkerKey } from './syntaxReveal'

describe('heading syntax reveal', () => {
  it('uses a different widget key for every heading level', () => {
    expect(headingMarkerKey(3)).toBe('block-h-3')
    expect(headingMarkerKey(2)).toBe('block-h-2')
    expect(headingMarkerKey(3)).not.toBe(headingMarkerKey(2))
  })
})
