import { useEffect, useRef, useState } from 'react'
import Editor from './components/Editor'
import StatusBar from './components/StatusBar/StatusBar'
import TabBar from './components/Tabs/TabBar'
import Sidebar from './components/Workspace/Sidebar'
import { useWorkspace } from './store/workspace'

function App(): React.JSX.Element {
  const saveActive = useWorkspace((s) => s.saveActive)
  const openFolder = useWorkspace((s) => s.openFolder)
  const openFileByDialog = useWorkspace((s) => s.openFileByDialog)
  const openDropped = useWorkspace((s) => s.openDropped)

  const [dragging, setDragging] = useState(false)
  const [sidebarVisible, setSidebarVisible] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      }
    }
    window.addEventListener('keydown', onKey)
    // 阻止 Electron 默认行为（拖入文件会导航到该文件、替换页面）
    const prevent = (e: DragEvent): void => e.preventDefault()
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    const disposeQueryClose = window.api.app.onQueryClose(() => {
      const hasDirty = useWorkspace.getState().tabs.some((t) => t.dirty)
      if (!hasDirty || window.confirm('有未保存的文件，仍要退出吗？')) {
        window.api.app.confirmClose()
      }
    })
    const disposeMenuOpenFile = window.api.app.onMenuOpenFile(() => {
      void openFileByDialog()
    })
    const disposeMenuOpenFolder = window.api.app.onMenuOpenFolder(() => {
      void openFolder()
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
      disposeQueryClose()
      disposeMenuOpenFile()
      disposeMenuOpenFolder()
    }
  }, [saveActive, openFolder, openFileByDialog])

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
      className={'app-layout' + (sidebarVisible ? ' sidebar-visible' : '')}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className={'sidebar' + (sidebarVisible ? '' : ' sidebar-hidden')}>
        <Sidebar />
      </div>
      <div className="main-pane">
        <TabBar />
        <Editor />
        <StatusBar
          sidebarVisible={sidebarVisible}
          onToggleSidebar={() => setSidebarVisible((visible) => !visible)}
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
