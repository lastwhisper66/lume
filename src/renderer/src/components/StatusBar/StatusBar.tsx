import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppSettings } from '../../store/settings'
import { useWorkspace } from '../../store/workspace'
import { countWords } from '../Outline/documentInfo'
import { detectDocumentLanguage, documentText } from './languageDetection'
import { displayLanguage } from './languageDisplay'
import SpellcheckMenu from './SpellcheckMenu'

interface StatusBarProps {
  sidebarVisible: boolean
  onToggleSidebar: () => void
}

export function StatusBar({ sidebarVisible, onToggleSidebar }: StatusBarProps): React.JSX.Element {
  const doc = useWorkspace((state) => state.document?.editorState.doc)
  const snapshot = useAppSettings((state) => state.snapshot)
  const setSpellcheckMode = useAppSettings((state) => state.setSpellcheckMode)
  const submitDetectedLanguage = useAppSettings((state) => state.submitDetectedLanguage)
  const words = useMemo(() => countWords(doc), [doc])
  const sidebarLabel = sidebarVisible ? '隐藏侧边栏' : '显示侧边栏'
  const [menuOpen, setMenuOpen] = useState(false)
  const spellcheckRef = useRef<HTMLDivElement>(null)
  const lastSubmittedLanguage = useRef<string | null>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (event: PointerEvent): void => {
      if (!spellcheckRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  useEffect(() => {
    if (snapshot?.spellcheck.mode !== 'auto') {
      lastSubmittedLanguage.current = null
      return
    }
    const text = documentText(doc)
    const timer = window.setTimeout(() => {
      const language = detectDocumentLanguage(text)
      if (!language || language === lastSubmittedLanguage.current) return
      lastSubmittedLanguage.current = language
      void submitDetectedLanguage(language).catch(() => {
        lastSubmittedLanguage.current = null
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [doc, snapshot?.spellcheck.mode, submitDetectedLanguage])

  const actualLanguage = snapshot?.actualSpellcheckLanguage ?? null
  const spellcheckTitle =
    snapshot?.spellcheck.mode === 'off'
      ? '拼写检查已关闭'
      : actualLanguage
        ? `拼写检查：${displayLanguage(actualLanguage)} (${actualLanguage.toUpperCase()})`
        : '拼写检查：自动检测语言'

  return (
    <div className="status-bar">
      <button
        className="sidebar-toggle"
        type="button"
        aria-label={sidebarLabel}
        title={sidebarLabel}
        onClick={onToggleSidebar}
      >
        {sidebarVisible ? '‹' : '›'}
      </button>
      <div className="status-actions">
        <div className="spellcheck-control" ref={spellcheckRef}>
          <button
            className="spellcheck-toggle"
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={spellcheckTitle}
            title={spellcheckTitle}
            disabled={!snapshot}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{snapshot?.spellcheck.mode === 'off' ? '×' : '✓'}</span>
            <span>拼写检查</span>
          </button>
          {menuOpen && snapshot && (
            <SpellcheckMenu
              snapshot={snapshot}
              onSelectMode={(mode, language) => void setSpellcheckMode(mode, language)}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </div>
        <span className="word-count">{words} 词</span>
      </div>
    </div>
  )
}

export default StatusBar
