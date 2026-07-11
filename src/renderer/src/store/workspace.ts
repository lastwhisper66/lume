import { create } from 'zustand'
import { EditorState } from 'prosemirror-state'
import type { FileNode } from '../../../preload/index'
import { schema } from '../components/Editor/schema/gfm'
import { buildPlugins } from '../components/Editor/plugins'
import { parse } from '../components/Editor/markdown/parser'
import { serialize } from '../components/Editor/markdown/serializer'

export interface WorkspaceDocument {
  filePath: string
  title: string
  dirty: boolean
  editorState: EditorState
}

interface WorkspaceStore {
  root: string | null
  tree: FileNode[]
  document: WorkspaceDocument | null

  openFolder: () => Promise<void>
  openFile: (path: string) => Promise<boolean>
  openFileByDialog: () => Promise<void>
  openDropped: (files: File[]) => Promise<void>
  updateDocumentState: (filePath: string, state: EditorState) => void
  saveActive: () => Promise<boolean>
}

function makeState(markdown: string): EditorState {
  return EditorState.create({ doc: parse(markdown), schema, plugins: buildPlugins() })
}

export const useWorkspace = create<WorkspaceStore>((set, get) => {
  let openQueue: Promise<void> = Promise.resolve()

  const saveDocument = async (
    document: WorkspaceDocument
  ): Promise<{ saved: true } | { saved: false; error: unknown }> => {
    try {
      await window.api.file.save(document.filePath, serialize(document.editorState.doc))
      set((state) => {
        const current = state.document
        if (
          current?.filePath !== document.filePath ||
          current.editorState.doc !== document.editorState.doc
        ) {
          return {}
        }
        return { document: { ...current, dirty: false } }
      })
      return { saved: true }
    } catch (error) {
      return { saved: false, error }
    }
  }

  const saveBeforeReplace = async (): Promise<boolean> => {
    let current = get().document
    while (current?.dirty) {
      const result = await saveDocument(current)
      if (!result.saved) {
        window.alert('自动保存失败，请手动保存后再进行操作')
        return false
      }
      current = get().document
    }
    return true
  }

  const replaceDocument = async (path: string): Promise<boolean> => {
    const current = get().document
    if (current?.filePath === path) return true

    if (!(await saveBeforeReplace())) return false

    try {
      const content = await window.api.file.read(path)
      if (!(await saveBeforeReplace())) return false
      set({
        document: {
          filePath: path,
          title: path.split(/[\\/]/).pop() ?? path,
          dirty: false,
          editorState: makeState(content)
        }
      })
      return true
    } catch (error) {
      window.alert(`打开失败：${String(error)}`)
      return false
    }
  }

  const enqueueOpen = <T>(operation: () => Promise<T>): Promise<T> => {
    const request = openQueue.then(operation)
    openQueue = request.then(
      () => undefined,
      () => undefined
    )
    return request
  }

  return {
    root: null,
    tree: [],
    document: null,

    openFolder: () =>
      enqueueOpen(async () => {
        const res = await window.api.workspace.openFolder()
        if (!res) return
        set({ root: res.root, tree: res.tree })
      }),

    openFile: (path) => enqueueOpen(() => replaceDocument(path)),

    openFileByDialog: () =>
      enqueueOpen(async () => {
        const path = await window.api.workspace.openFile()
        if (!path) return
        await replaceDocument(path)
      }),

    openDropped: (files) => {
      const droppedFiles = [...files]
      return enqueueOpen(async () => {
        const paths = droppedFiles.map((file) => window.api.dnd.pathForFile(file)).filter(Boolean)
        if (paths.length === 0) return
        const result = await window.api.workspace.openDropped(paths)
        set({ root: result.root, tree: result.tree })
        if (result.files[0]) await replaceDocument(result.files[0])
      })
    },

    updateDocumentState: (filePath, state) =>
      set((workspace) => {
        const current = workspace.document
        if (current?.filePath !== filePath) return {}
        return {
          document: {
            ...current,
            editorState: state,
            dirty: current.dirty || state.doc !== current.editorState.doc
          }
        }
      }),

    saveActive: async () => {
      const current = get().document
      if (!current) return true
      const result = await saveDocument(current)
      if (!result.saved) window.alert(`保存失败：${String(result.error)}`)
      return result.saved
    }
  }
})
