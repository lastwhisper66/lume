import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { baseName } from './pathLabel'

interface RecentsSectionProps {
  title: string
  items: string[]
  onOpen: (path: string) => void
  onRemove: (path: string) => void
  onClear: () => void
}

function RecentsSection({
  title,
  items,
  onOpen,
  onRemove,
  onClear
}: RecentsSectionProps): React.JSX.Element {
  return (
    <section className="recents-section">
      <header className="recents-section-header">
        <h3 className="recents-section-title">{title}</h3>
        {items.length > 0 && (
          <button type="button" className="recents-clear" onClick={onClear}>
            清空
          </button>
        )}
      </header>
      {items.length === 0 ? (
        <p className="recents-empty">暂无</p>
      ) : (
        <ul className="recents-list">
          {items.map((path) => (
            <li key={path} className="recents-item">
              <button
                type="button"
                className="recents-open"
                onClick={() => onOpen(path)}
                title={path}
              >
                <span className="recents-name">{baseName(path)}</span>
                <span className="recents-path">{path}</span>
              </button>
              <button
                type="button"
                className="recents-remove"
                onClick={() => onRemove(path)}
                aria-label={`从列表移除 ${baseName(path)}`}
                title="从列表移除"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export interface RecentsDialogProps {
  open: boolean
  onClose: () => void
  recentFiles: string[]
  recentFolders: string[]
  onOpenFile: (path: string) => void
  onOpenFolder: (path: string) => void
  onRemove: (kind: 'file' | 'folder', path: string) => void
  onClear: (kind: 'file' | 'folder') => void
}

export function RecentsDialog(props: RecentsDialogProps): React.JSX.Element | null {
  const { open, onClose } = props

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="recents-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="recents-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="最近打开的项目"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="recents-dialog-header">
          <h2 className="recents-dialog-title">最近打开的项目</h2>
          <button type="button" className="recents-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="recents-body">
          <RecentsSection
            title="文件"
            items={props.recentFiles}
            onOpen={props.onOpenFile}
            onRemove={(path) => props.onRemove('file', path)}
            onClear={() => props.onClear('file')}
          />
          <RecentsSection
            title="文件夹"
            items={props.recentFolders}
            onOpen={props.onOpenFolder}
            onRemove={(path) => props.onRemove('folder', path)}
            onClear={() => props.onClear('folder')}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}

export default RecentsDialog
