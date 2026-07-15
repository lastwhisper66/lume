export type SpellcheckMode = 'auto' | 'off' | 'language'

export interface ThemeSettings {
  themeMode: 'system' | 'manual'
  manualTheme: string
  dayTheme: string
  nightTheme: string
}

export interface SpellcheckSettings {
  mode: SpellcheckMode
  language: string | null
  detectedLanguage: string | null
}

export interface AppSettings extends ThemeSettings {
  spellcheck: SpellcheckSettings
  sidebarVisible: boolean
  sidebarWidth: number
}

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 600
export const SIDEBAR_DEFAULT_WIDTH = 260

export interface SettingsSnapshot extends AppSettings {
  availableLanguages: string[]
  actualSpellcheckLanguage: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  manualTheme: 'light',
  dayTheme: 'light',
  nightTheme: 'dark',
  spellcheck: { mode: 'auto', language: null, detectedLanguage: null },
  sidebarVisible: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function clampSidebarWidth(value: unknown): number {
  const width = typeof value === 'number' && Number.isFinite(value) ? value : SIDEBAR_DEFAULT_WIDTH
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)))
}

export function normalizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const spellcheck =
    raw.spellcheck && typeof raw.spellcheck === 'object'
      ? (raw.spellcheck as Record<string, unknown>)
      : {}
  const mode =
    spellcheck.mode === 'off' || spellcheck.mode === 'language' ? spellcheck.mode : 'auto'

  return {
    themeMode: raw.themeMode === 'manual' ? 'manual' : 'system',
    manualTheme: stringOr(raw.manualTheme, DEFAULT_SETTINGS.manualTheme),
    dayTheme: stringOr(raw.dayTheme, DEFAULT_SETTINGS.dayTheme),
    nightTheme: stringOr(raw.nightTheme, DEFAULT_SETTINGS.nightTheme),
    spellcheck: {
      mode,
      language: nullableString(spellcheck.language),
      detectedLanguage: nullableString(spellcheck.detectedLanguage)
    },
    sidebarVisible: raw.sidebarVisible === true,
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth)
  }
}

export type SettingsPatch = Partial<Omit<AppSettings, 'spellcheck'>> & {
  spellcheck?: Partial<SpellcheckSettings>
}

export function mergeSettings(current: AppSettings, patch: SettingsPatch): AppSettings {
  return normalizeSettings({
    ...current,
    ...patch,
    spellcheck: { ...current.spellcheck, ...patch.spellcheck }
  })
}
