import { useState } from 'react'
import Outline from '../Outline/Outline'
import FileTree from './FileTree'

type SidebarPage = 'files' | 'outline'

export function Sidebar(): React.JSX.Element {
  const [page, setPage] = useState<SidebarPage>('files')

  return (
    <>
      <div className="sidebar-tabs" role="tablist" aria-label="侧边栏">
        <button
          id="sidebar-tab-files"
          className={'sidebar-tab' + (page === 'files' ? ' active' : '')}
          type="button"
          role="tab"
          aria-selected={page === 'files'}
          aria-controls="sidebar-panel"
          onClick={() => setPage('files')}
        >
          文件
        </button>
        <button
          id="sidebar-tab-outline"
          className={'sidebar-tab' + (page === 'outline' ? ' active' : '')}
          type="button"
          role="tab"
          aria-selected={page === 'outline'}
          aria-controls="sidebar-panel"
          onClick={() => setPage('outline')}
        >
          大纲
        </button>
      </div>
      <div
        id="sidebar-panel"
        className="sidebar-content"
        role="tabpanel"
        aria-labelledby={`sidebar-tab-${page}`}
      >
        {page === 'files' ? <FileTree /> : <Outline />}
      </div>
    </>
  )
}

export default Sidebar
