// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EditorState } from 'prosemirror-state'
import { parse } from '../components/Editor/markdown/parser'
import { schema } from '../components/Editor/schema/gfm'
import { registerTransientEditFlush } from '../components/Editor/transientEdits'
import { useWorkspace } from './workspace'

describe('workspace transient edit snapshots', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    useWorkspace.setState({ document: null, root: null, tree: [] })
    vi.unstubAllGlobals()
  })

  it('stores an editable heading prefix internally and saves it exactly once', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      file: { save }
    } as unknown as typeof window.api)
    const editorState = EditorState.create({ doc: parse('# Old'), schema })
    useWorkspace.setState({
      document: {
        id: 98,
        filePath: 'heading.md',
        title: 'heading.md',
        dirty: true,
        editorState
      }
    })

    expect(editorState.doc.firstChild?.textContent).toBe('# Old')

    await useWorkspace.getState().saveActive()

    expect(save).toHaveBeenCalledWith('heading.md', '# Old')
    expect(useWorkspace.getState().document?.dirty).toBe(false)
  })

  it('flushes transient edits before saveActive snapshots the document', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', {
      file: { save }
    } as unknown as typeof window.api)
    const editorState = EditorState.create({ doc: parse('# Old'), schema })
    useWorkspace.setState({
      document: {
        id: 99,
        filePath: 'draft.md',
        title: 'draft.md',
        dirty: false,
        editorState
      }
    })
    cleanups.push(
      registerTransientEditFlush(() => {
        const current = useWorkspace.getState().document
        if (!current) return
        const paragraph = schema.nodes.paragraph.create(null, schema.text('Latest draft'))
        const transaction = current.editorState.tr.replaceWith(
          0,
          current.editorState.doc.firstChild?.nodeSize ?? 0,
          paragraph
        )
        useWorkspace
          .getState()
          .updateDocumentState(current.id, current.editorState.apply(transaction))
      })
    )

    await useWorkspace.getState().saveActive()

    expect(save).toHaveBeenCalledWith('draft.md', 'Latest draft')
    expect(useWorkspace.getState().document?.editorState.doc.firstChild?.textContent).toBe(
      'Latest draft'
    )
  })

  it('flushes transient edits before autosaving a document replacement', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    const read = vi.fn().mockResolvedValue('# Replacement')
    vi.stubGlobal('api', {
      file: { save, read }
    } as unknown as typeof window.api)
    const editorState = EditorState.create({ doc: parse('# Old'), schema })
    useWorkspace.setState({
      document: {
        id: 100,
        filePath: 'old.md',
        title: 'old.md',
        dirty: false,
        editorState
      }
    })
    let unregister = (): void => undefined
    unregister = registerTransientEditFlush(() => {
      unregister()
      const current = useWorkspace.getState().document
      if (!current) return
      const paragraph = schema.nodes.paragraph.create(null, schema.text('Draft before replace'))
      const transaction = current.editorState.tr.replaceWith(
        0,
        current.editorState.doc.firstChild?.nodeSize ?? 0,
        paragraph
      )
      useWorkspace
        .getState()
        .updateDocumentState(current.id, current.editorState.apply(transaction))
    })
    cleanups.push(unregister)

    await useWorkspace.getState().openFile('replacement.md')

    expect(save).toHaveBeenCalledWith('old.md', 'Draft before replace')
    expect(read).toHaveBeenCalledWith('replacement.md')
    expect(useWorkspace.getState().document?.filePath).toBe('replacement.md')
  })
})
