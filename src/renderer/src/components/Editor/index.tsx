import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from './schema/base'
import { buildPlugins } from './plugins'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import './Editor.css'

interface EditorProps {
  /** 初始 Markdown 文本 */
  initialMarkdown: string
  /** 文档变化时回调，返回最新序列化后的 Markdown */
  onChange?: (markdown: string) => void
}

export function Editor({ initialMarkdown, onChange }: EditorProps): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!mountRef.current) return

    const doc: PMNode = parse(initialMarkdown)
    const state = EditorState.create({ doc, schema, plugins: buildPlugins() })
    const view = new EditorView(mountRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged && onChange) {
          onChange(serialize(newState.doc))
        }
      }
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在挂载时创建一次；initialMarkdown 变化由上层通过 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
