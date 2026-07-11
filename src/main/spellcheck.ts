import type { SettingsSnapshot, SpellcheckMode } from '../shared/settings'
import type { SettingsStore } from './settings'

export interface SpellcheckSession {
  readonly availableSpellCheckerLanguages: string[]
  getSpellCheckerLanguages(): string[]
  setSpellCheckerEnabled(enabled: boolean): void
  setSpellCheckerLanguages(languages: string[]): void
}

function baseLanguage(code: string): string {
  return code.toLowerCase().split('-')[0]
}

function canonicalLanguage(code: unknown, available: string[]): string | null {
  if (typeof code !== 'string') return null
  return available.find((candidate) => candidate.toLowerCase() === code.toLowerCase()) ?? null
}

export function chooseDictionary(
  detectedBase: string,
  available: string[],
  preferredLocales: string[],
  current: string[]
): string | null {
  const normalizedBase = baseLanguage(detectedBase)
  const candidates = available.filter((code) => baseLanguage(code) === normalizedBase)
  if (candidates.length === 0) return null

  for (const locale of preferredLocales) {
    const exact = candidates.find((candidate) => candidate.toLowerCase() === locale.toLowerCase())
    if (exact) return exact
  }

  const enabled = current.find((code) =>
    candidates.some((candidate) => candidate.toLowerCase() === code.toLowerCase())
  )
  if (enabled) return canonicalLanguage(enabled, candidates)
  return candidates[0]
}

export class SpellcheckController {
  private readonly available: string[]

  constructor(
    private readonly settingsStore: SettingsStore,
    private readonly session: SpellcheckSession,
    private readonly preferredLocales: string[]
  ) {
    this.available = [...session.availableSpellCheckerLanguages].sort((a, b) =>
      a.localeCompare(b)
    )
  }

  private fallbackLanguage(): string | null {
    const current = this.session.getSpellCheckerLanguages()
    const enabled = current.map((code) => canonicalLanguage(code, this.available)).find(Boolean)
    if (enabled) return enabled

    for (const locale of this.preferredLocales) {
      const matched = chooseDictionary(locale, this.available, [locale], current)
      if (matched) return matched
    }
    return this.available[0] ?? null
  }

  private desiredLanguage(): string | null {
    const { spellcheck } = this.settingsStore.getState()
    if (spellcheck.mode === 'off') return null
    if (spellcheck.mode === 'language') {
      return canonicalLanguage(spellcheck.language, this.available) ?? this.fallbackLanguage()
    }
    return canonicalLanguage(spellcheck.detectedLanguage, this.available) ?? this.fallbackLanguage()
  }

  apply(): void {
    const { mode } = this.settingsStore.getState().spellcheck
    if (mode === 'off') {
      this.session.setSpellCheckerEnabled(false)
      return
    }

    this.session.setSpellCheckerEnabled(true)
    const language = this.desiredLanguage()
    if (language) this.session.setSpellCheckerLanguages([language])
  }

  snapshot(): SettingsSnapshot {
    const settings = this.settingsStore.getState()
    const actualSpellcheckLanguage =
      settings.spellcheck.mode === 'off'
        ? null
        : (this.session.getSpellCheckerLanguages()[0] ?? this.desiredLanguage())
    return {
      ...settings,
      availableLanguages: [...this.available],
      actualSpellcheckLanguage
    }
  }

  async setMode(mode: unknown, language?: unknown): Promise<SettingsSnapshot> {
    let patch: { mode: SpellcheckMode; language: string | null } | null = null
    if (mode === 'auto') patch = { mode, language: null }
    if (mode === 'off') patch = { mode, language: null }
    if (mode === 'language') {
      const canonical = canonicalLanguage(language, this.available)
      if (canonical) patch = { mode, language: canonical }
    }
    if (!patch) return this.snapshot()

    const saving = this.settingsStore.update({ spellcheck: patch })
    this.apply()
    await saving
    return this.snapshot()
  }

  async submitDetectedBaseLanguage(value: unknown): Promise<SettingsSnapshot> {
    if (typeof value !== 'string' || !/^[a-z]{2,3}$/i.test(value)) return this.snapshot()
    const settings = this.settingsStore.getState()
    if (settings.spellcheck.mode !== 'auto') return this.snapshot()

    const language = chooseDictionary(
      value,
      this.available,
      this.preferredLocales,
      this.session.getSpellCheckerLanguages()
    )
    if (!language) return this.snapshot()
    if (settings.spellcheck.detectedLanguage === language) {
      this.apply()
      return this.snapshot()
    }

    const saving = this.settingsStore.update({
      spellcheck: { detectedLanguage: language }
    })
    this.apply()
    await saving
    return this.snapshot()
  }
}
