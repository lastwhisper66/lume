import { useMemo } from 'react'
import { useWorkspace } from '../../store/workspace'
import { countWords } from '../Outline/documentInfo'

interface StatusBarProps {
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function StatusBar({ sidebarVisible, onToggleSidebar }: StatusBarProps): React.JSX.Element {
  const doc = useWorkspace((state) => state.document?.editorState.doc)
  const words = useMemo(() => countWords(doc), [doc])
  const sidebarLabel = sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'

  return (
    <div className="status-bar">
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarLabel}
        title={sidebarLabel}
        onClick={onToggleSidebar}
      >
        {sidebarVisible ? '‹' : '›'}
      </button>
      <span className="word-count">{words} 词</span>
    </div>
  )
}

export default StatusBar
