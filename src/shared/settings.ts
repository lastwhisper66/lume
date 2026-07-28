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
  recentFiles: string[]
  recentFolders: string[]
}

export const SIDEBAR_MIN_WIDTH = 180
export const SIDEBAR_MAX_WIDTH = 600
export const SIDEBAR_DEFAULT_WIDTH = 260

/** 每类最近项持久化上限 */
export const RECENTS_MAX = 50
/** 菜单中每类最多直接展示的条数 */
export const RECENTS_MENU_LIMIT = 5

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
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  recentFiles: [],
  recentFolders: []
}

/** 去重（大小写不敏感，贴合 Windows/macOS 路径语义）、去空、截断到上限。 */
export function normalizeRecents(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length === 0) continue
    const key = entry.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(entry)
    if (result.length >= RECENTS_MAX) break
  }
  return result
}

/** 把 path 移到列表最前（去重后），并截断到上限。 */
export function pushRecent(list: string[], path: string): string[] {
  if (typeof path !== 'string' || path.length === 0) return normalizeRecents(list)
  const key = path.toLowerCase()
  const filtered = normalizeRecents(list).filter((entry) => entry.toLowerCase() !== key)
  return [path, ...filtered].slice(0, RECENTS_MAX)
}

/** 从列表移除 path（大小写不敏感）。 */
export function removeRecent(list: string[], path: string): string[] {
  const key = path.toLowerCase()
  return normalizeRecents(list).filter((entry) => entry.toLowerCase() !== key)
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
    sidebarWidth: clampSidebarWidth(raw.sidebarWidth),
    recentFiles: normalizeRecents(raw.recentFiles),
    recentFolders: normalizeRecents(raw.recentFolders)
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
