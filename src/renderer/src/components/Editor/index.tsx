import { useEffect, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { useWorkspace } from '../../store/workspace'
import 'prosemirror-tables/style/tables.css'
import './Editor.css'

export function Editor(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  const activeTabId = useWorkspace((s) => s.activeTabId)
  const activeState = useWorkspace((s) => s.tabs.find((t) => t.id === s.activeTabId)?.editorState)
  const updateTabState = useWorkspace((s) => s.updateTabState)

  // 创建/销毁 view
  useEffect(() => {
    if (!mountRef.current || !activeState) return
    const view = new EditorView(mountRef.current, {
      state: activeState,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        const id = useWorkspace.getState().activeTabId
        if (id) updateTabState(id, newState)
      }
    })
    return () => {
      view.destroy()
    }
    // 仅依赖 activeTabId：切换 tab 时重建 view 并加载该 tab 的 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabId])

  if (!activeState) {
    return <div className="lume-editor lume-empty">打开一个 Markdown 文件开始编辑</div>
  }
  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
