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

describe('inline code in table cells', () => {
  // 反引号内部不处理反斜杠转义，所以转义分隔符会累积：`~~` → `\~\~` → `\\\~\\\~`
  it('does not escape delimiters inside inline code', () => {
    const md = ['| h |', '| --- |', '| `~~` |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('stays stable across repeated round-trips', () => {
    const md = ['| h |', '| --- |', '| `*x*` and `_y_` |'].join('\n')
    const once = roundTrip(md)
    expect(once).toBe(md)
    expect(roundTrip(once)).toBe(once)
  })

  it('still escapes delimiters in non-code cells', () => {
    const doc = parse(['| h |', '| --- |', '| plain |'].join('\n'))
    const cell = doc.firstChild!.child(1).child(0)
    expect(cell.textContent).toBe('plain')
    // 非代码单元格里的字面 * 仍需转义，否则再次解析会变成 em
    expect(roundTrip(['| h |', '| --- |', '| a \\* b |'].join('\n'))).toBe(
      ['| h |', '| --- |', '| a \\* b |'].join('\n')
    )
  })

  it('widens the fence when the code content contains backticks', () => {
    const md = ['| h |', '| --- |', '| ``a ` b`` |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })

  it('combines inline code with other marks', () => {
    const md = ['| h |', '| --- |', '| **`x`** |'].join('\n')
    expect(roundTrip(md)).toBe(md)
  })
})
