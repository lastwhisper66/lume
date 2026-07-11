import { useWorkspace } from '../../store/workspace'

export function DocumentHeader(): React.JSX.Element {
  const title = useWorkspace((state) => state.document?.title)

  return (
    <header className="document-header" aria-label="当前文档">
      {title && (
        <span className="document-title" title={title}>
          {title}
        </span>
      )}
    </header>
  )
}

export default DocumentHeader
