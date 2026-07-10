import { create } from 'zustand'
import { EditorState } from 'prosemirror-state'
import type { FileNode } from '../../../preload/index'
import { schema } from '../components/Editor/schema/gfm'
import { buildPlugins } from '../components/Editor/plugins'
import { parse } from '../components/Editor/markdown/parser'
import { serialize } from '../components/Editor/markdown/serializer'

export interface Tab {
  id: string
  filePath: string
  title: string
  dirty: boolean
  editorState: EditorState
}

interface WorkspaceStore {
  root: string | null
  tree: FileNode[]
  tabs: Tab[]
  activeTabId: string | null

  openFolder: () => Promise<void>
  openFile: (path: string) => Promise<void>
  openFileByDialog: () => Promise<void>
  setActive: (id: string) => void
  updateTabState: (id: string, state: EditorState) => void
  saveActive: () => Promise<void>
  closeTab: (id: string) => void
}

function makeState(markdown: string): EditorState {
  return EditorState.create({ doc: parse(markdown), schema, plugins: buildPlugins() })
}

export const useWorkspace = create<WorkspaceStore>((set, get) => ({
  root: null,
  tree: [],
  tabs: [],
  activeTabId: null,

  openFolder: async () => {
    const res = await window.api.workspace.openFolder()
    if (!res) return
    set({ root: res.root, tree: res.tree })
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.filePath === path)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    const content = await window.api.file.read(path)
    const tab: Tab = {
      id: path,
      filePath: path,
      title: path.split(/[\\/]/).pop() ?? path,
      dirty: false,
      editorState: makeState(content)
    }
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
  },

  openFileByDialog: async () => {
    const path = await window.api.workspace.openFile()
    if (!path) return
    await get().openFile(path)
  },

  setActive: (id) => set({ activeTabId: id }),

  updateTabState: (id, state) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === id
          ? { ...t, editorState: state, dirty: t.dirty || state.doc !== t.editorState.doc }
          : t
      )
    })),

  saveActive: async () => {
    const { tabs, activeTabId } = get()
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) return
    try {
      await window.api.file.save(tab.filePath, serialize(tab.editorState.doc))
      set((s) => ({ tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)) }))
    } catch (e) {
      window.alert(`保存失败：${String(e)}`)
    }
  },

  closeTab: (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (tab?.dirty && !window.confirm(`「${tab.title}」有未保存改动，仍要关闭吗？`)) return
    set((s) => {
      const tabs = s.tabs.filter((t) => t.id !== id)
      const activeTabId =
        s.activeTabId === id ? (tabs.length ? tabs[tabs.length - 1].id : null) : s.activeTabId
      return { tabs, activeTabId }
    })
  }
}))
