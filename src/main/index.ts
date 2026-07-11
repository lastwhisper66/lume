import { app, shell, BrowserWindow, ipcMain, dialog, nativeTheme } from 'electron'
import { join, resolve, relative, isAbsolute, dirname, basename } from 'path'
import { promises as fs } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { ThemeManager } from './theme'
import type { ThemePayload } from './theme'
import { buildAppMenu } from './menu'

const TITLE_BAR_HEIGHT = 38
const LIGHT_TITLE_BAR = { color: '#f7f8fa', symbolColor: '#2b2b2b' }
const DARK_TITLE_BAR = { color: '#181818', symbolColor: '#d4d4d4' }
const supportsTitleBarOverlay = process.platform === 'win32' || process.platform === 'linux'

function cssVariable(css: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const declarations = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .matchAll(new RegExp(`${escapedName}\\s*:\\s*([^;}\\r\\n]+)`, 'gi'))
  let value: string | undefined
  for (const declaration of declarations)
    value = declaration[1].replace(/\s*!important\s*$/i, '').trim()
  if (!value || /^(?:var|calc|color-mix)\(/i.test(value)) return null
  return value
}

function titleBarOverlayFor(payload: ThemePayload): {
  color: string
  symbolColor: string
  height: number
} {
  const prefersDarkFallback =
    /(?:dark|night)/i.test(payload.name) ||
    /color-scheme\s*:\s*dark/i.test(payload.css) ||
    nativeTheme.shouldUseDarkColors
  const fallback = prefersDarkFallback ? DARK_TITLE_BAR : LIGHT_TITLE_BAR

  return {
    color:
      cssVariable(payload.css, '--lume-bg-sidebar') ??
      cssVariable(payload.css, '--lume-bg') ??
      fallback.color,
    symbolColor: cssVariable(payload.css, '--lume-text') ?? fallback.symbolColor,
    height: TITLE_BAR_HEIGHT
  }
}

function applyTitleBarOverlay(window: BrowserWindow, payload: ThemePayload): void {
  if (!supportsTitleBarOverlay || typeof window.setTitleBarOverlay !== 'function') return
  try {
    window.setTitleBarOverlay(titleBarOverlayFor(payload))
  } catch {
    // Older/unsupported window managers may expose the method without accepting overlays.
  }
}

interface FileNode {
  name: string
  path: string
  isDir: boolean
  children?: FileNode[]
}

async function readMarkdownTree(dir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory() && ['node_modules', 'dist', 'out'].includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const children = await readMarkdownTree(full)
      if (children.length > 0) nodes.push({ name: entry.name, path: full, isDir: true, children })
    } else if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
      nodes.push({ name: entry.name, path: full, isDir: false })
    }
  }
  nodes.sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
  return nodes
}

function collectMarkdownPaths(nodes: FileNode[]): string[] {
  return nodes.flatMap((node) =>
    node.isDir ? collectMarkdownPaths(node.children ?? []) : [node.path]
  )
}

function dedupeMarkdownTree(nodes: FileNode[], seenPaths: Set<string>): FileNode[] {
  const deduped: FileNode[] = []
  for (const node of nodes) {
    if (node.isDir) {
      const children = dedupeMarkdownTree(node.children ?? [], seenPaths)
      if (children.length > 0) deduped.push({ ...node, children })
      continue
    }

    const resolved = resolve(node.path)
    if (seenPaths.has(resolved)) continue
    seenPaths.add(resolved)
    deduped.push({ ...node, path: resolved })
  }
  return deduped
}

// 已打开的工作区根目录集合：切换文件夹后，原工作区中的当前文档仍可通过路径校验并自动保存
const workspaceRoots = new Set<string>()

function assertInWorkspace(p: string): string {
  const resolved = resolve(p)
  if (workspaceRoots.size === 0) throw new Error('未打开工作区')
  for (const root of workspaceRoots) {
    const rel = relative(root, resolved)
    if (rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)) {
      return resolved
    }
  }
  throw new Error('路径越界，拒绝访问')
}

const themeManager = new ThemeManager()

/** 把当前有效主题推给所有窗口，并重建菜单勾选 */
async function pushTheme(): Promise<void> {
  const payload = await themeManager.currentCss()
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send('theme:apply', payload)
    applyTitleBarOverlay(w, payload)
  }
  await buildAppMenu(themeManager)
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1428,
    height: 1072,
    show: false,
    title: 'Lume',
    titleBarStyle: 'hidden',
    ...(supportsTitleBarOverlay
      ? {
          titleBarOverlay: {
            ...LIGHT_TITLE_BAR,
            height: TITLE_BAR_HEIGHT
          }
        }
      : {}),
    autoHideMenuBar: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  let allowClose = false
  mainWindow.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    mainWindow.webContents.send('app:queryClose')
  })
  ipcMain.on('app:confirmClose', () => {
    allowClose = true
    mainWindow.close()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.lume.app')

  await themeManager.init(() => {
    void pushTheme()
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle('workspace:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (canceled || !filePaths[0]) return null
    const root = filePaths[0]
    workspaceRoots.add(root)
    const tree = await readMarkdownTree(root)
    return { root, tree }
  })

  ipcMain.handle('workspace:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    if (canceled || !filePaths[0]) return null
    const filePath = filePaths[0]
    // 允许保存该文件：把其所在目录纳入工作区根集合
    workspaceRoots.add(dirname(filePath))
    return filePath
  })

  ipcMain.handle('workspace:openDropped', async (_e, paths: string[]) => {
    const tree: FileNode[] = []
    const files: string[] = []
    const displayedPaths = new Set<string>()
    const directoryRoots: string[] = []
    const seenDirectoryRoots = new Set<string>()
    for (const p of paths) {
      const resolved = resolve(p)
      const stat = await fs.stat(resolved).catch(() => null)
      if (!stat) continue
      if (stat.isDirectory()) {
        workspaceRoots.add(resolved)
        if (seenDirectoryRoots.has(resolved)) continue
        seenDirectoryRoots.add(resolved)
        directoryRoots.push(resolved)
        const allChildren = await readMarkdownTree(resolved)
        const children = dedupeMarkdownTree(allChildren, displayedPaths)
        if (children.length === 0 && collectMarkdownPaths(allChildren).length > 0) continue
        tree.push({
          name: basename(resolved) || resolved,
          path: resolved,
          isDir: true,
          children
        })
        files.push(...collectMarkdownPaths(children))
      } else if (stat.isFile() && /\.(md|markdown)$/i.test(resolved)) {
        workspaceRoots.add(dirname(resolved))
        if (displayedPaths.has(resolved)) continue
        displayedPaths.add(resolved)
        tree.push({ name: basename(resolved), path: resolved, isDir: false })
        files.push(resolved)
      }
    }
    const naturalRoot = directoryRoots.length === 1 ? directoryRoots[0] : null
    const onlyNaturalRoot =
      naturalRoot !== null && tree.length === 1 && tree[0].isDir && tree[0].path === naturalRoot
    return {
      root: onlyNaturalRoot ? naturalRoot : null,
      tree: onlyNaturalRoot ? (tree[0].children ?? []) : tree,
      files
    }
  })

  ipcMain.handle('file:read', async (_e, path: string) => {
    return fs.readFile(assertInWorkspace(path), 'utf-8')
  })

  ipcMain.handle('file:save', async (_e, path: string, content: string) => {
    await fs.writeFile(assertInWorkspace(path), content, 'utf-8')
  })

  ipcMain.handle('file:saveAs', async (_e, content: string) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (canceled || !filePath) return null
    await fs.writeFile(filePath, content, 'utf-8')
    return filePath
  })

  ipcMain.handle('theme:current', () => themeManager.currentCss())
  ipcMain.handle('theme:list', () => themeManager.listThemes())
  ipcMain.on('theme:select', (_e, name: string) => {
    void themeManager.select(name)
  })
  ipcMain.on('theme:setMode', (_e, patch: Partial<import('./theme').ThemeSettings>) => {
    void themeManager.setMode(patch)
  })
  ipcMain.on('theme:openFolder', () => {
    themeManager.openFolder()
  })
  ipcMain.on('theme:rescan', () => {
    themeManager.rescan()
  })
  ipcMain.on('window:setTitle', (event, title: string) => {
    const normalizedTitle = typeof title === 'string' && title.trim() ? title : 'Lume'
    BrowserWindow.fromWebContents(event.sender)?.setTitle(normalizedTitle)
  })

  createWindow()
  await buildAppMenu(themeManager)

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
