import { useEffect } from 'react'
import Editor from './components/Editor'
import FileTree from './components/Workspace/FileTree'
import TabBar from './components/Tabs/TabBar'
import { useWorkspace } from './store/workspace'
import './App.css'

function App(): React.JSX.Element {
  const saveActive = useWorkspace((s) => s.saveActive)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveActive()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [saveActive])

  return (
    <div className="app-layout">
      <div className="sidebar">
        <FileTree />
      </div>
      <div className="main-pane">
        <TabBar />
        <Editor />
      </div>
    </div>
  )
}

export default App
