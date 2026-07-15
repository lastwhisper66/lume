import { useEffect, useRef } from 'react'
import { EditorView } from 'prosemirror-view'
import { useWorkspace } from '../../store/workspace'
import { registerEditorView } from '../Outline/editorScroll'
import { CodeBlockView } from './nodeviews/codeblock'
import { ImageView } from './nodeviews/image'
import { HeadingSourceView } from './nodeviews/headingSource'
import { HorizontalRuleView } from './nodeviews/horizontalRuleSource'
import 'prosemirror-tables/style/tables.css'

export function Editor(): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)

  const documentId = useWorkspace((s) => s.document?.id)
  const editorState = useWorkspace((s) => s.document?.editorState)
  const updateDocumentState = useWorkspace((s) => s.updateDocumentState)

  // 创建/销毁 view
  useEffect(() => {
    if (!mountRef.current || documentId === undefined || !editorState) return
    const view = new EditorView(mountRef.current, {
      state: editorState,
      nodeViews: {
        heading: (node, view, getPos) => new HeadingSourceView(node, view, getPos),
        horizontal_rule: (node, view, getPos) => new HorizontalRuleView(node, view, getPos),
        code_block: (node, view, getPos) => new CodeBlockView(node, view, getPos),
        image: (node, view, getPos) => new ImageView(node, view, getPos)
      },
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        updateDocumentState(documentId, newState)
      }
    })
    const unregisterEditorView = registerEditorView(view)
    return () => {
      unregisterEditorView()
      view.destroy()
    }
    // 仅依赖 documentId：每次装载文档时重建 view 并加载该文档的 state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId])

  if (!editorState) {
    return <div className="lume-editor lume-empty">打开一个 Markdown 文件开始编辑</div>
  }
  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
