import { useEffect, useRef, useState } from 'react'
import Editor from './components/Editor'
import { flushTransientEdits } from './components/Editor/transientEdits'
import DocumentHeader from './components/Navigation/DocumentHeader'
import MenuBar from './components/Navigation/MenuBar'
import StatusBar from './components/StatusBar/StatusBar'
import Sidebar from './components/Workspace/Sidebar'
import { useAppSettings } from './store/settings'
import { useWorkspace } from './store/workspace'
import { clampSidebarWidth, SIDEBAR_DEFAULT_WIDTH } from '../../shared/settings'

function App(): React.JSX.Element {
  const saveActive = useWorkspace((s) => s.saveActive)
  const openFolder = useWorkspace((s) => s.openFolder)
  const openFileByDialog = useWorkspace((s) => s.openFileByDialog)
  const openDropped = useWorkspace((s) => s.openDropped)
  const closeActive = useWorkspace((s) => s.closeActive)
  const hydrateSettings = useAppSettings((s) => s.hydrate)
  const sidebarVisible = useAppSettings((s) => s.snapshot?.sidebarVisible ?? false)
  const setSidebarVisible = useAppSettings((s) => s.setSidebarVisible)
  const sidebarWidth = useAppSettings((s) => s.snapshot?.sidebarWidth ?? SIDEBAR_DEFAULT_WIDTH)
  const setSidebarWidth = useAppSettings((s) => s.setSidebarWidth)

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  const [resizing, setResizing] = useState(false)
  const [draftWidth, setDraftWidth] = useState(sidebarWidth)
  const resizeState = useRef({ startX: 0, startWidth: sidebarWidth, width: sidebarWidth })

  const beginResize = (e: React.MouseEvent<HTMLDivElement>): void => {
    e.preventDefault()
    resizeState.current = { startX: e.clientX, startWidth: sidebarWidth, width: sidebarWidth }
    setDraftWidth(sidebarWidth)
    setResizing(true)
  }

  useEffect(() => {
    if (!resizing) return
    const onMove = (e: MouseEvent): void => {
      const state = resizeState.current
      const next = clampSidebarWidth(state.startWidth + (e.clientX - state.startX))
      state.width = next
      setDraftWidth(next)
    }
    const onUp = (): void => {
      setResizing(false)
      const state = resizeState.current
      if (state.width !== state.startWidth) void setSidebarWidth(state.width)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [resizing, setSidebarWidth])

  const effectiveSidebarWidth = resizing ? draftWidth : sidebarWidth

  useEffect(() => {
    void hydrateSettings()
  }, [hydrateSettings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      } else if (mod && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        void closeActive()
      } else if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        if (e.shiftKey) void openFolder()
        else void openFileByDialog()
      }
    }
    window.addEventListener('keydown', onKey)
    // 阻止 Electron 默认行为（拖入文件会导航到该文件、替换页面）
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    const disposeQueryClose = window.api.app.onQueryClose(() => {
      flushTransientEdits()
      const hasDirty = useWorkspace.getState().document?.dirty === true
      if (!hasDirty || window.confirm('有未保存的文件，仍要退出吗？')) {
        window.api.app.confirmClose()
      }
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
      disposeQueryClose()
    }
  }, [saveActive, openFolder, openFileByDialog, closeActive])

  const hasFiles = (e: React.DragEvent): boolean => e.dataTransfer.types.includes('Files')

  const onDragEnter = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    dragDepth.current += 1
    setDragging(true)
  }
  const onDragOver = (e: React.DragEvent): void => {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }
  const onDragLeave = (): void => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }
  const onDrop = (e: React.DragEvent): void => {
    dragDepth.current = 0
    setDragging(false)
    if (!hasFiles(e)) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) void openDropped(files)
  }

  return (
    <div
      className={
        'app-layout' +
        (sidebarVisible ? ' sidebar-visible' : '') +
        (resizing ? ' sidebar-resizing' : '')
      }
      style={{ '--lume-sidebar-width': `${effectiveSidebarWidth}px` } as React.CSSProperties}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <DocumentHeader />
      <MenuBar />
      <div className={'sidebar' + (sidebarVisible ? '' : ' sidebar-hidden')}>
        <Sidebar />
      </div>
      {sidebarVisible && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          onMouseDown={beginResize}
        />
      )}
      <div className="main-pane">
        <Editor />
        <StatusBar
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => void setSidebarVisible(!sidebarVisible)}
        />
      </div>
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-overlay-inner">拖入文件或文件夹以打开</div>
        </div>
      )}
    </div>
  )
}

export default App
