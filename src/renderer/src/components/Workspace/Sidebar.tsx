import { useState } from 'react'
import Outline from '../Outline/Outline'
import FileTree from './FileTree'

type SidebarPage = 'files' | 'outline'

export function Sidebar(): React.JSX.Element {
  const [page, setPage] = useState<SidebarPage>('files')

  return (
    <>
      <div className="sidebar-tabs" role="group" aria-label="侧边栏">
        <button
          className={'sidebar-tab' + (page === 'files' ? ' active' : '')}
          type="button"
          onClick={() => setPage('files')}
        >
          文件
        </button>
        <button
          className={'sidebar-tab' + (page === 'outline' ? ' active' : '')}
          type="button"
          onClick={() => setPage('outline')}
        >
          大纲
        </button>
      </div>
      <div className="sidebar-content">{page === 'files' ? <FileTree /> : <Outline />}</div>
    </>
  )
}

export default Sidebar
