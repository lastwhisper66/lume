import { useEffect, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { useWorkspace } from '../../store/workspace'
import { registerEditorView } from '../Outline/editorScroll'
import { CodeBlockView } from './nodeviews/codeblock'
import { ImageView } from './nodeviews/image'
import 'prosemirror-tables/style/tables.css'

export function Editor(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  const filePath = useWorkspace((s) => s.document?.filePath)
  const editorState = useWorkspace((s) => s.document?.editorState)
  const updateDocumentState = useWorkspace((s) => s.updateDocumentState)

  // 创建/销毁 view
  useEffect(() => {
    if (!mountRef.current || !editorState) return
    const view = new EditorView(mountRef.current, {
      state: editorState,
      nodeViews: {
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
        image: (node, view, getPos) => new ImageView(node, view, getPos)
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        updateDocumentState(newState)
      }
    })
    const unregisterEditorView = registerEditorView(view)
    return () => {
      unregisterEditorView()
      view.destroy()
    }
    // 仅依赖 filePath：切换文档时重建 view 并加载该文档的 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath])

  if (!editorState) {
    return <div className="lume-editor lume-empty">打开一个 Markdown 文件开始编辑</div>
  }
  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
