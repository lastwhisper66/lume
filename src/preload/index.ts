import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

const api = {
  workspace: {
    openFolder: (): Promise<{ root: string; tree: FileNode[] } | null> =>
      ipcRenderer.invoke('workspace:openFolder')
  },
  file: {
    read: (path: string): Promise<string> => ipcRenderer.invoke('file:read', path),
    save: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('file:save', path, content),
    saveAs: (content: string): Promise<string | null> =>
      ipcRenderer.invoke('file:saveAs', content)
  },
  app: {
    onQueryClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('app:queryClose', listener)
      return () => ipcRenderer.removeListener('app:queryClose', listener)
    },
    confirmClose: (): void => {
      ipcRenderer.send('app:confirmClose')
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}

export type Api = typeof api
