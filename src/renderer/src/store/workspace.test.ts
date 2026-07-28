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

describe('workspace closeActive', () => {
  afterEach(() => {
    useWorkspace.setState({ document: null, root: null, tree: [] })
    vi.unstubAllGlobals()
  })

  const openDocument = (dirty: boolean): void => {
    const editorState = EditorState.create({ doc: parse('# Title'), schema })
    useWorkspace.setState({
      document: { id: 1, filePath: 'note.md', title: 'note.md', dirty, editorState }
    })
  }

  it('auto-saves a dirty document before clearing it', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', { file: { save } } as unknown as typeof window.api)
    openDocument(true)

    await useWorkspace.getState().closeActive()

    expect(save).toHaveBeenCalledWith('note.md', '# Title')
    expect(useWorkspace.getState().document).toBeNull()
  })

  it('closes a clean document without saving', async () => {
    const save = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('api', { file: { save } } as unknown as typeof window.api)
    openDocument(false)

    await useWorkspace.getState().closeActive()

    expect(save).not.toHaveBeenCalled()
    expect(useWorkspace.getState().document).toBeNull()
  })

  it('keeps the document open when auto-save fails', async () => {
    const save = vi.fn().mockRejectedValue(new Error('disk full'))
    vi.stubGlobal('api', { file: { save } } as unknown as typeof window.api)
    vi.stubGlobal('alert', vi.fn())
    openDocument(true)

    await useWorkspace.getState().closeActive()

    expect(useWorkspace.getState().document?.filePath).toBe('note.md')
  })
})
