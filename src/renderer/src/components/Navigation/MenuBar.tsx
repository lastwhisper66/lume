import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppSettings } from '../../store/settings'
import { useWorkspace } from '../../store/workspace'
import { RECENTS_MENU_LIMIT } from '../../../../shared/settings'
import RecentsDialog from './RecentsDialog'
import { baseName } from './pathLabel'

type MenuId = 'file' | 'theme'

const EMPTY_RECENTS: string[] = []

interface RecentSubmenuProps {
  recentFiles: string[]
  recentFolders: string[]
  onOpenFile: (path: string) => void
  onOpenFolder: (path: string) => void
  onShowAll: () => void
}

function RecentItems({
  items,
  onOpen
}: {
  items: string[]
  onOpen: (path: string) => void
}): React.JSX.Element {
  if (items.length === 0) {
    return (
      <div className="menu-option menu-option-empty" role="menuitem" aria-disabled="true">
        <span className="menu-option-check" aria-hidden="true" />
        <span className="menu-option-label">（暂无）</span>
      </div>
    )
  }
  return (
    <>
      {items.map((path) => (
        <button
          key={path}
          className="menu-option"
          type="button"
          role="menuitem"
          title={path}
          onClick={() => onOpen(path)}
        >
          <span className="menu-option-check" aria-hidden="true" />
          <span className="menu-option-label">{baseName(path)}</span>
        </button>
      ))}
    </>
  )
}

function RecentSubmenu({
  recentFiles,
  recentFolders,
  onOpenFile,
  onOpenFolder,
  onShowAll
}: RecentSubmenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={'menu-submenu' + (open ? ' is-open' : '')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        className="menu-option"
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="menu-option-check" aria-hidden="true" />
        <span className="menu-option-label">最近打开的项目</span>
        <span className="menu-option-arrow" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="menu-flyout menu-flyout-recents" role="menu" aria-label="最近打开的项目">
          <div className="menu-section-label" role="presentation">
            文件
          </div>
          <RecentItems items={recentFiles.slice(0, RECENTS_MENU_LIMIT)} onOpen={onOpenFile} />
          <div className="menu-separator" role="separator" />
          <div className="menu-section-label" role="presentation">
            文件夹
          </div>
          <RecentItems items={recentFolders.slice(0, RECENTS_MENU_LIMIT)} onOpen={onOpenFolder} />
          <div className="menu-separator" role="separator" />
          <button className="menu-option" type="button" role="menuitem" onClick={onShowAll}>
            <span className="menu-option-check" aria-hidden="true" />
            <span className="menu-option-label">更多…</span>
          </button>
        </div>
      )}
    </div>
  )
}

interface ThemeSubmenuProps {
  label: string
  themes: string[]
  selected: string | undefined
  onSelect: (name: string) => void
}

function ThemeSubmenu({ label, themes, selected, onSelect }: ThemeSubmenuProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div
      className={'menu-submenu' + (open ? ' is-open' : '')}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
    >
      <button
        className="menu-option"
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="menu-option-check" aria-hidden="true" />
        <span className="menu-option-label">{label}</span>
        <span className="menu-option-arrow" aria-hidden="true">
          ›
        </span>
      </button>
      {open && (
        <div className="menu-flyout" role="menu" aria-label={label}>
          {themes.map((name) => (
            <button
              key={name}
              className="menu-option"
              type="button"
              role="menuitemradio"
              aria-checked={selected === name}
              onClick={() => onSelect(name)}
            >
              <span className="menu-option-check" aria-hidden="true">
                {selected === name ? '✓' : ''}
              </span>
              <span className="menu-option-label">{name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function MenuBar(): React.JSX.Element {
  const snapshot = useAppSettings((state) => state.snapshot)
  const removeRecent = useAppSettings((state) => state.removeRecent)
  const clearRecents = useAppSettings((state) => state.clearRecents)
  const openFolder = useWorkspace((state) => state.openFolder)
  const openFileByDialog = useWorkspace((state) => state.openFileByDialog)
  const openRecentFile = useWorkspace((state) => state.openRecentFile)
  const openRecentFolder = useWorkspace((state) => state.openRecentFolder)
  const closeActive = useWorkspace((state) => state.closeActive)
  const hasDocument = useWorkspace((state) => state.document !== null)

  const recentFiles = snapshot?.recentFiles ?? EMPTY_RECENTS
  const recentFolders = snapshot?.recentFolders ?? EMPTY_RECENTS

  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [recentsOpen, setRecentsOpen] = useState(false)
  const [themes, setThemes] = useState<string[]>([])
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      void window.api.theme.list().then((list) => {
        if (alive) setThemes(list)
      })
    }
    load()
    // 主题应用时重新拉取列表，覆盖「重新扫描主题」后的增删
    const dispose = window.api.theme.onApply(() => load())
    return () => {
      alive = false
      dispose()
    }
  }, [])

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!barRef.current?.contains(event.target as Node)) setOpenMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const close = useCallback(() => setOpenMenu(null), [])
  const run = useCallback(
    (fn: () => void): void => {
      fn()
      close()
    },
    [close]
  )

  const themeMode = snapshot?.themeMode
  const manualTheme = snapshot?.manualTheme
  const dayTheme = snapshot?.dayTheme
  const nightTheme = snapshot?.nightTheme

  return (
    <div className="menu-bar" ref={barRef} role="menubar" aria-label="应用菜单">
      <div className="menu-root">
        <button
          type="button"
          className={'menu-root-btn' + (openMenu === 'file' ? ' is-open' : '')}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'file'}
          onClick={() => setOpenMenu((current) => (current === 'file' ? null : 'file'))}
          onPointerEnter={() => setOpenMenu((current) => (current ? 'file' : current))}
        >
          文件
        </button>
        {openMenu === 'file' && (
          <div className="menu-dropdown" role="menu" aria-label="文件">
            <button
              className="menu-option"
              type="button"
              role="menuitem"
              onClick={() => run(() => void openFileByDialog())}
            >
              <span className="menu-option-check" aria-hidden="true" />
              <span className="menu-option-label">打开文件…</span>
              <span className="menu-option-accel">Ctrl+O</span>
            </button>
            <button
              className="menu-option"
              type="button"
              role="menuitem"
              onClick={() => run(() => void openFolder())}
            >
              <span className="menu-option-check" aria-hidden="true" />
              <span className="menu-option-label">打开文件夹…</span>
              <span className="menu-option-accel">Ctrl+Shift+O</span>
            </button>
            <div className="menu-separator" role="separator" />
            <RecentSubmenu
              recentFiles={recentFiles}
              recentFolders={recentFolders}
              onOpenFile={(path) => run(() => void openRecentFile(path))}
              onOpenFolder={(path) => run(() => void openRecentFolder(path))}
              onShowAll={() => run(() => setRecentsOpen(true))}
            />
            <div className="menu-separator" role="separator" />
            <button
              className="menu-option"
              type="button"
              role="menuitem"
              disabled={!hasDocument}
              onClick={() => run(() => void closeActive())}
            >
              <span className="menu-option-check" aria-hidden="true" />
              <span className="menu-option-label">关闭文件</span>
              <span className="menu-option-accel">Ctrl+W</span>
            </button>
          </div>
        )}
      </div>

      <div className="menu-root">
        <button
          type="button"
          className={'menu-root-btn' + (openMenu === 'theme' ? ' is-open' : '')}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={openMenu === 'theme'}
          onClick={() => setOpenMenu((current) => (current === 'theme' ? null : 'theme'))}
          onPointerEnter={() => setOpenMenu((current) => (current ? 'theme' : current))}
        >
          主题
        </button>
        {openMenu === 'theme' && (
          <div className="menu-dropdown" role="menu" aria-label="主题">
            <button
              className="menu-option"
              type="button"
              role="menuitemcheckbox"
              aria-checked={themeMode === 'system'}
              onClick={() =>
                run(() =>
                  window.api.theme.setMode({
                    themeMode: themeMode === 'system' ? 'manual' : 'system'
                  })
                )
              }
            >
              <span className="menu-option-check" aria-hidden="true">
                {themeMode === 'system' ? '✓' : ''}
              </span>
              <span className="menu-option-label">跟随系统</span>
            </button>
            <div className="menu-separator" role="separator" />
            {themes.map((name) => (
              <button
                key={name}
                className="menu-option"
                type="button"
                role="menuitemradio"
                aria-checked={themeMode === 'manual' && manualTheme === name}
                onClick={() => run(() => window.api.theme.select(name))}
              >
                <span className="menu-option-check" aria-hidden="true">
                  {themeMode === 'manual' && manualTheme === name ? '✓' : ''}
                </span>
                <span className="menu-option-label">{name}</span>
              </button>
            ))}
            <div className="menu-separator" role="separator" />
            <ThemeSubmenu
              label="日间主题"
              themes={themes}
              selected={dayTheme}
              onSelect={(name) => run(() => window.api.theme.setMode({ dayTheme: name }))}
            />
            <ThemeSubmenu
              label="夜间主题"
              themes={themes}
              selected={nightTheme}
              onSelect={(name) => run(() => window.api.theme.setMode({ nightTheme: name }))}
            />
            <div className="menu-separator" role="separator" />
            <button
              className="menu-option"
              type="button"
              role="menuitem"
              onClick={() => run(() => window.api.theme.openFolder())}
            >
              <span className="menu-option-check" aria-hidden="true" />
              <span className="menu-option-label">打开主题文件夹</span>
            </button>
            <button
              className="menu-option"
              type="button"
              role="menuitem"
              onClick={() => run(() => window.api.theme.rescan())}
            >
              <span className="menu-option-check" aria-hidden="true" />
              <span className="menu-option-label">重新扫描主题</span>
            </button>
          </div>
        )}
      </div>

      <RecentsDialog
        open={recentsOpen}
        onClose={() => setRecentsOpen(false)}
        recentFiles={recentFiles}
        recentFolders={recentFolders}
        onOpenFile={(path) => {
          setRecentsOpen(false)
          void openRecentFile(path)
        }}
        onOpenFolder={(path) => {
          setRecentsOpen(false)
          void openRecentFolder(path)
        }}
        onRemove={(kind, path) => void removeRecent(kind, path)}
        onClear={(kind) => void clearRecents(kind)}
      />
    </div>
  )
}

export default MenuBar
