import { describe, expect, it } from 'vitest'
import { parse } from './parser'
import { serialize } from './serializer'

/** 解析 → 序列化，去掉尾部空白后返回 */
function roundTrip(md: string): string {
  return serialize(parse(md)).trimEnd()
}

describe('table alignment round-trip', () => {
  it('preserves a plain (unaligned) table', () => {
    const md = ['| a | b |', '| --- | --- |', '| 1 | 2 |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('preserves left / center / right column alignment', () => {
    const md = ['| a | b | c |', '| :--- | :---: | ---: |', '| 1 | 2 | 3 |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('reads alignment onto every cell of a column, not just the header', () => {
    const doc = parse(['| a | b |', '| :---: | ---: |', '| 1 | 2 |'].join('\n'))
    const table = doc.firstChild!
    const headerRow = table.child(0)
    const bodyRow = table.child(1)
    expect(headerRow.child(0).attrs.align).toBe('center')
    expect(headerRow.child(1).attrs.align).toBe('right')
    // 对齐是按列的：正文行单元格也应带上同一对齐
    expect(bodyRow.child(0).attrs.align).toBe('center')
    expect(bodyRow.child(1).attrs.align).toBe('right')
  })

  it('keeps alignment when the body has more rows than the header', () => {
    const md = ['| h |', '| ---: |', '| 1 |', '| 2 |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })
})
