import { useEffect } from 'react'
import { useWorkspace } from '../../store/workspace'

export function DocumentHeader(): React.JSX.Element {
  const document = useWorkspace((state) => state.document)
  const title = document?.title ?? 'Lume'

  useEffect(() => {
    window.api.window.setTitle(title)
  }, [title])

  return (
    <header className="document-header" aria-label="当前文档">
      <span className="document-title" title={title}>
        {title}
      </span>
    </header>
  )
}

export default DocumentHeader
