import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { parse } from './markdown/parser'
import { headingNormalizationKey, headingNormalizationPlugin } from './headingNormalization'

function createState(source: string): EditorState {
  return EditorState.create({ doc: parse(source), plugins: [headingNormalizationPlugin] })
}

describe('heading normalization', () => {
  it('updates the heading level after editing the prefix', () => {
    let state = createState('# Title')

    state = state.apply(state.tr.insertText('#', 1))

    expect(state.doc.firstChild?.type.name).toBe('heading')
    expect(state.doc.firstChild?.attrs.level).toBe(2)
    expect(state.doc.firstChild?.textContent).toBe('## Title')
  })

  it('turns a heading into a paragraph when its required space is deleted', () => {
    let state = createState('# Title')

    state = state.apply(state.tr.delete(2, 3))

    expect(state.doc.firstChild?.type.name).toBe('paragraph')
    expect(state.doc.firstChild?.textContent).toBe('#Title')
  })

  it('recovers a level-six heading after deleting one of seven hashes', () => {
    let state = createState('####### Title')

    state = state.apply(state.tr.delete(1, 2))

    expect(state.doc.firstChild?.type.name).toBe('heading')
    expect(state.doc.firstChild?.attrs.level).toBe(6)
    expect(state.doc.firstChild?.textContent).toBe('###### Title')
  })

  it('turns repaired paragraph source back into a heading', () => {
    let state = createState('# Title')
    state = state.apply(state.tr.delete(2, 3))

    state = state.apply(state.tr.insertText(' ', 2))

    expect(state.doc.firstChild?.type.name).toBe('heading')
    expect(state.doc.firstChild?.attrs.level).toBe(1)
    expect(state.doc.firstChild?.textContent).toBe('# Title')
  })

  it('clears every mark from the prefix while preserving body marks', () => {
    let state = createState('## Title')
    const strong = state.schema.marks.strong.create()

    state = state.apply(state.tr.addMark(1, 9, strong))

    const heading = state.doc.firstChild
    expect(heading?.firstChild?.text).toBe('## ')
    expect(heading?.firstChild?.marks).toHaveLength(0)
    expect(heading?.lastChild?.text).toBe('Title')
    expect(heading?.lastChild?.marks).toEqual([strong])
  })

  it('preserves the exact text selection while changing the block type', () => {
    let state = createState('# Title')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 5)))

    state = state.apply(state.tr.delete(2, 3))

    expect(state.doc.firstChild?.type.name).toBe('paragraph')
    expect(state.selection.from).toBe(4)
    expect(state.selection.to).toBe(4)
  })

  it('normalizes multiple blocks in one tagged transaction without appending forever', () => {
    const state = createState('# First\n\n## Second')
    const secondPos = state.doc.child(0).nodeSize
    const result = state.applyTransaction(
      state.tr.delete(secondPos + 3, secondPos + 4).delete(2, 3)
    )

    expect(result.state.doc.child(0).type.name).toBe('paragraph')
    expect(result.state.doc.child(1).type.name).toBe('paragraph')
    expect(result.transactions).toHaveLength(2)
    expect(result.transactions[1].getMeta(headingNormalizationKey)).toBe(true)
  })
})
