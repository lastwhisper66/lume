import { useEffect } from 'react'
import { useWorkspace } from '../../store/workspace'
import WindowBrand from './WindowBrand'

export function DocumentHeader(): React.JSX.Element {
  const document = useWorkspace((state) => state.document)
  const title = document?.title

  useEffect(() => {
    window.api.window.setTitle(title ?? 'Lume')
  }, [title])

  return (
    <header className="document-header" aria-label="窗口标题栏">
      <WindowBrand />
      {title && (
        <span className="document-title" title={title}>
          {title}
        </span>
      )}
    </header>
  )
}

export default DocumentHeader
