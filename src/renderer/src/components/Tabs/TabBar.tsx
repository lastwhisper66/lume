import { useWorkspace } from '../../store/workspace'

export function TabBar(): React.JSX.Element {
  const tabs = useWorkspace((s) => s.tabs)
  const activeTabId = useWorkspace((s) => s.activeTabId)
  const setActive = useWorkspace((s) => s.setActive)
  const closeTab = useWorkspace((s) => s.closeTab)

  if (tabs.length === 0) return <div className="tab-bar tab-bar-empty" />

  return (
    <div className="tab-bar">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={'tab' + (t.id === activeTabId ? ' active' : '')}
          onClick={() => setActive(t.id)}
        >
          <span className="tab-title">{t.title}</span>
          <span className="tab-dirty">{t.dirty ? '●' : ''}</span>
          <span
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  )
}

export default TabBar
