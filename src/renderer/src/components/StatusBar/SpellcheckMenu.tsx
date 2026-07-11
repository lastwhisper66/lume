import { useMemo, useState } from 'react'
import type { SettingsSnapshot, SpellcheckMode } from '../../../../preload/index'
import { displayLanguage } from './languageDisplay'

interface SpellcheckMenuProps {
  snapshot: SettingsSnapshot
  onSelectMode: (mode: SpellcheckMode, language?: string) => void
  onClose: () => void
}

function languageCode(code: string): string {
  return code.toUpperCase()
}

interface MenuOptionProps {
  checked: boolean
  label: string
  detail?: string
  onClick: () => void
}

function MenuOption({ checked, label, detail, onClick }: MenuOptionProps): React.JSX.Element {
  return (
    <button
      className={'spellcheck-option' + (checked ? ' is-checked' : '')}
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
    >
      <span className="spellcheck-check" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="spellcheck-name">{label}</span>
      {detail && <span className="spellcheck-code">{detail}</span>}
    </button>
  )
}

export function SpellcheckMenu({
  snapshot,
  onSelectMode,
  onClose
}: SpellcheckMenuProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const languages = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return snapshot.availableLanguages
      .map((code) => ({ code, name: displayLanguage(code) }))
      .filter(({ code, name }) => {
        if (!normalizedQuery) return true
        return `${name} ${code}`.toLocaleLowerCase().includes(normalizedQuery)
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  }, [query, snapshot.availableLanguages])

  const select = (mode: SpellcheckMode, language?: string): void => {
    onSelectMode(mode, language)
    onClose()
  }

  const actualLanguage = snapshot.actualSpellcheckLanguage
  const autoDetail = actualLanguage
    ? `${displayLanguage(actualLanguage)} · ${languageCode(actualLanguage)}`
    : '等待足够文本'

  return (
    <div
      className="spellcheck-menu"
      role="menu"
      aria-label="拼写检查语言"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <div className="spellcheck-search-wrap">
        <input
          className="spellcheck-search"
          type="search"
          value={query}
          placeholder="搜索拼写检查语言"
          aria-label="搜索拼写检查语言"
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="spellcheck-mode-options">
        <MenuOption
          checked={snapshot.spellcheck.mode === 'auto'}
          label="自动检测语言"
          detail={autoDetail}
          onClick={() => select('auto')}
        />
        <MenuOption
          checked={snapshot.spellcheck.mode === 'off'}
          label="不使用拼写检查"
          onClick={() => select('off')}
        />
      </div>
      <div className="spellcheck-separator" role="separator" />
      <div className="spellcheck-options">
        {languages.map(({ code, name }) => (
          <MenuOption
            key={code}
            checked={
              snapshot.spellcheck.mode === 'language' &&
              snapshot.spellcheck.language?.toLowerCase() === code.toLowerCase()
            }
            label={name}
            detail={languageCode(code)}
            onClick={() => select('language', code)}
          />
        ))}
        {languages.length === 0 && <div className="spellcheck-empty">没有匹配的语言</div>}
      </div>
    </div>
  )
}

export default SpellcheckMenu
