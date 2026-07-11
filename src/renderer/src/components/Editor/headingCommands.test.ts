import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { Command } from 'prosemirror-state'
import { keepHeadingCaretAtStart, lowerHeadingLevel } from './commands'
import { schema } from './schema/gfm'

function headingState(level: number): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level }, [schema.text('Heading')])
  ])
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
    plugins: [history()]
  })
}

function runCommand(state: EditorState, command: Command): EditorState {
  let next = state
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}

describe('heading marker keyboard commands', () => {
  it.each([
    [6, 'heading', 5],
    [5, 'heading', 4],
    [4, 'heading', 3],
    [3, 'heading', 2],
    [2, 'heading', 1],
    [1, 'paragraph', null]
  ] as const)('lowers H%s by one marker', (level, type, expectedLevel) => {
    const next = runCommand(headingState(level), lowerHeadingLevel)
    expect(next.doc.firstChild?.type.name).toBe(type)
    expect(next.doc.firstChild?.attrs.level ?? null).toBe(expectedLevel)
    expect(next.doc.firstChild?.textContent).toBe('Heading')
    expect(next.selection.from).toBe(1)
  })

  it('does not run away from the start of a heading', () => {
    const initial = headingState(3)
    const moved = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 3)))
    expect(lowerHeadingLevel(moved)).toBe(false)
    expect(keepHeadingCaretAtStart(moved)).toBe(false)
  })

  it('consumes ArrowLeft at the revealed marker boundary without changing the document', () => {
    const state = headingState(2)
    expect(keepHeadingCaretAtStart(state)).toBe(true)
    expect(state.doc.firstChild?.attrs.level).toBe(2)
  })

  it('can undo a heading level change', () => {
    let state = runCommand(headingState(3), lowerHeadingLevel)
    expect(state.doc.firstChild?.attrs.level).toBe(2)
    expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true)
    expect(state.doc.firstChild?.attrs.level).toBe(3)
  })
})
