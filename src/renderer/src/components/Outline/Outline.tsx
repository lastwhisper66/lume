import { useMemo } from 'react'
import { useWorkspace } from '../../store/workspace'
import { extractOutline } from './documentInfo'
import { scrollEditorTo } from './editorScroll'

export function Outline(): React.JSX.Element {
  const doc = useWorkspace((state) => state.document?.editorState.doc)
  const entries = useMemo(() => extractOutline(doc), [doc])

  if (entries.length === 0) {
    return (
      <div className="outline-panel is-empty">
        <div className="outline-empty">大纲内容为空</div>
      </div>
    )
  }

  return (
    <div className="outline-panel">
      {entries.map((entry) => (
        <button
          key={`${entry.pos}-${entry.level}`}
          className="outline-item"
          type="button"
          title={entry.text}
          style={{ '--outline-level': entry.level } as React.CSSProperties}
          onClick={() => scrollEditorTo(entry.pos)}
        >
          {entry.text}
        </button>
      ))}
    </div>
  )
}

export default Outline
