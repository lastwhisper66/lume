import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import type { EditorView } from 'prosemirror-view'
import { buildInputRules } from './inputrules'
import { parse } from './markdown/parser'
import { schema } from './schema/gfm'
import { setHeadingLevel, setParagraph, splitHeading } from './commands'

function stateAt(source: string, anchor: number, head = anchor, withHistory = false): EditorState {
  const doc = parse(source)
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, anchor, head),
    plugins: withHistory ? [history()] : []
  })
}

function runCommand(state: EditorState, command: typeof splitHeading): EditorState {
  let next = state
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}

describe('heading block commands', () => {
  it('converts a paragraph to H3 with an editable prefix', () => {
    const state = stateAt('Title', 3)
    const next = runCommand(state, setHeadingLevel(3))

    expect(next.doc.firstChild?.type.name).toBe('heading')
    expect(next.doc.firstChild?.attrs.level).toBe(3)
    expect(next.doc.firstChild?.textContent).toBe('### Title')
    expect(next.selection.from).toBe(7)
  })

  it('changes H1 to H2 with exactly one prefix', () => {
    const state = stateAt('# Title', 5)
    const next = runCommand(state, setHeadingLevel(2))

    expect(next.doc.firstChild?.textContent).toBe('## Title')
    expect(next.selection.from).toBe(6)
  })

  it('converts a heading to a paragraph and keeps body-relative selection', () => {
    const state = stateAt('# Title', 5)
    const next = runCommand(state, setParagraph)

    expect(next.doc.firstChild?.type.name).toBe('paragraph')
    expect(next.doc.firstChild?.textContent).toBe('Title')
    expect(next.selection.from).toBe(3)
  })

  it('preserves body marks while keeping the replacement prefix unmarked', () => {
    const strong = schema.marks.strong.create()
    const paragraph = schema.nodes.paragraph.create(null, schema.text('Title', [strong]))
    const doc = schema.node('doc', null, [paragraph])
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3)
    })
    const heading = runCommand(state, setHeadingLevel(2)).doc.firstChild

    expect(heading?.firstChild?.text).toBe('## ')
    expect(heading?.firstChild?.marks).toHaveLength(0)
    expect(heading?.lastChild?.text).toBe('Title')
    expect(heading?.lastChild?.marks).toEqual([strong])
  })
})

describe('splitHeading', () => {
  it.each([
    ['at the body start', 3, '# ', 'Title'],
    ['in the body middle', 5, '# Ti', 'tle'],
    ['at the body end', 8, '# Title', '']
  ])('splits %s without moving the prefix into the paragraph', (_label, pos, left, right) => {
    const state = stateAt('# Title', pos)
    const next = runCommand(state, splitHeading)

    expect(next.doc.child(0).type.name).toBe('heading')
    expect(next.doc.child(0).textContent).toBe(left)
    expect(next.doc.child(1).type.name).toBe('paragraph')
    expect(next.doc.child(1).textContent).toBe(right)
    expect(next.selection.from).toBe(next.doc.child(0).nodeSize + 1)
  })

  it('clamps Enter inside the prefix to the body start', () => {
    const next = runCommand(stateAt('## Title', 2), splitHeading)

    expect(next.doc.child(0).textContent).toBe('## ')
    expect(next.doc.child(1).textContent).toBe('Title')
  })

  it('deletes a selected body range while splitting', () => {
    const next = runCommand(stateAt('# BeforeAfter', 8, 10), splitHeading)

    expect(next.doc.child(0).textContent).toBe('# Befor')
    expect(next.doc.child(1).textContent).toBe('fter')
  })

  it('preserves marks on both sides of the split', () => {
    const strong = schema.marks.strong.create()
    const heading = schema.nodes.heading.create({ level: 1 }, [
      schema.text('# '),
      schema.text('Title', [strong])
    ])
    const doc = schema.node('doc', null, [heading])
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 5) })
    const next = runCommand(state, splitHeading)

    expect(next.doc.child(0).lastChild?.marks).toEqual([strong])
    expect(next.doc.child(1).firstChild?.marks).toEqual([strong])
  })

  it('undoes the split in one step', () => {
    let state = stateAt('# Title', 5, 5, true)
    state = runCommand(state, splitHeading)
    expect(state.doc.childCount).toBe(2)

    let restored = state
    expect(undo(state, (tr) => (restored = state.apply(tr)))).toBe(true)
    expect(restored.doc.childCount).toBe(1)
    expect(restored.doc.firstChild?.textContent).toBe('# Title')
  })

  it('returns false when the selection crosses blocks', () => {
    const doc = parse('# One\n\n# Two')
    const secondStart = doc.child(0).nodeSize + 1
    const state = EditorState.create({
      doc,
      selection: TextSelection.create(doc, 3, secondStart + 2)
    })

    expect(splitHeading(state)).toBe(false)
  })
})

describe('heading input rule', () => {
  it('keeps the full marker when the final space creates a heading', () => {
    const plugin = buildInputRules()
    const paragraph = schema.nodes.paragraph.create(null, schema.text('#'))
    const doc = schema.node('doc', null, [paragraph])
    let state = EditorState.create({ doc, selection: TextSelection.create(doc, 2) })
    const view = {
      composing: false,
      get state() {
        return state
      },
      dispatch(tr) {
        state = state.apply(tr)
      }
    } as unknown as EditorView

    const handleTextInput = plugin.props.handleTextInput
    expect(handleTextInput?.call(plugin, view, 2, 2, ' ', () => state.tr)).toBe(true)
    expect(state.doc.firstChild?.type.name).toBe('heading')
    expect(state.doc.firstChild?.attrs.level).toBe(1)
    expect(state.doc.firstChild?.textContent).toBe('# ')
  })
})
