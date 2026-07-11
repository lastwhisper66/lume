import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { SettingsSnapshot, SpellcheckMode } from '../shared/settings'

export type { SettingsSnapshot, SpellcheckMode } from '../shared/settings'

export interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

export interface DroppedResult {
  root: string | null
  tree: FileNode[]
  files: string[]
}

const api = {
  window: {
    setTitle: (title: string): void => ipcRenderer.send('window:setTitle', title),
    setTitleBarOverlay: (overlay: { color: string; symbolColor: string }): void =>
      ipcRenderer.send('window:setTitleBarOverlay', overlay)
  },
  workspace: {
    openFolder: (): Promise<{ root: string; tree: FileNode[] } | null> =>
      ipcRenderer.invoke('workspace:openFolder'),
    openFile: (): Promise<string | null> => ipcRenderer.invoke('workspace:openFile'),
    openDropped: (paths: string[]): Promise<DroppedResult> =>
      ipcRenderer.invoke('workspace:openDropped', paths)
  },
  dnd: {
    /** 把拖入的 File 解析为绝对路径（Electron 39 已移除 File.path） */
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  file: {
    read: (path: string): Promise<string> => ipcRenderer.invoke('file:read', path),
    save: (path: string, content: string): Promise<void> =>
      ipcRenderer.invoke('file:save', path, content),
    saveAs: (content: string): Promise<string | null> => ipcRenderer.invoke('file:saveAs', content)
  },
  app: {
    onQueryClose: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('app:queryClose', listener)
      return () => ipcRenderer.removeListener('app:queryClose', listener)
    },
    confirmClose: (): void => {
      ipcRenderer.send('app:confirmClose')
    },
    onMenuOpenFile: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('menu:openFile', listener)
      return () => ipcRenderer.removeListener('menu:openFile', listener)
    },
    onMenuOpenFolder: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on('menu:openFolder', listener)
      return () => ipcRenderer.removeListener('menu:openFolder', listener)
    }
  },
  theme: {
    current: (): Promise<{ name: string; css: string }> => ipcRenderer.invoke('theme:current'),
    list: (): Promise<string[]> => ipcRenderer.invoke('theme:list'),
    select: (name: string): void => ipcRenderer.send('theme:select', name),
    setMode: (patch: {
      themeMode?: 'system' | 'manual'
      manualTheme?: string
      dayTheme?: string
      nightTheme?: string
    }): void => ipcRenderer.send('theme:setMode', patch),
    openFolder: (): void => ipcRenderer.send('theme:openFolder'),
    rescan: (): void => ipcRenderer.send('theme:rescan'),
    onApply: (cb: (p: { name: string; css: string }) => void): (() => void) => {
      const listener = (_e: unknown, p: { name: string; css: string }): void => cb(p)
      ipcRenderer.on('theme:apply', listener)
      return () => ipcRenderer.removeListener('theme:apply', listener)
    }
  },
  settings: {
    current: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('settings:current'),
    setSidebarVisible: (visible: boolean): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke('settings:setSidebarVisible', visible),
    setSpellcheckMode: (mode: SpellcheckMode, language?: string): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke('spellcheck:setMode', mode, language),
    submitDetectedLanguage: (baseLanguage: string): Promise<SettingsSnapshot> =>
      ipcRenderer.invoke('spellcheck:detected', baseLanguage),
    onChanged: (cb: (snapshot: SettingsSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, snapshot: SettingsSnapshot): void => cb(snapshot)
      ipcRenderer.on('settings:changed', listener)
      return () => ipcRenderer.removeListener('settings:changed', listener)
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
