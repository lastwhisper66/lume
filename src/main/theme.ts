import { app, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import lightCss from '../../resources/themes/light.css?raw'
import darkCss from '../../resources/themes/dark.css?raw'
import type { ThemeSettings } from '../shared/settings'
import type { SettingsStore } from './settings'

export type { ThemeSettings } from '../shared/settings'

export interface ThemePayload {
  name: string
  css: string
}

const BUILTIN: Record<string, string> = { light: lightCss, dark: darkCss }

export class ThemeManager {
  private themesDir = join(app.getPath('userData'), 'themes')
  private onChange: () => void = () => {}

  constructor(private readonly settingsStore: SettingsStore) {}

  /** 初始化：建主题夹、拷内置主题（缺失才拷）、读 settings、挂 nativeTheme 监听 */
  async init(onChange: () => void): Promise<void> {
    this.onChange = onChange
    await fs.mkdir(this.themesDir, { recursive: true })
    for (const [name, css] of Object.entries(BUILTIN)) {
      const p = join(this.themesDir, `${name}.css`)
      try {
        await fs.access(p)
      } catch {
        await fs.writeFile(p, css, 'utf-8')
      }
    }
    nativeTheme.on('updated', () => {
      if (this.getState().themeMode === 'system') this.onChange()
    })
  }

  getState(): ThemeSettings {
    const { themeMode, manualTheme, dayTheme, nightTheme } = this.settingsStore.getState()
    return { themeMode, manualTheme, dayTheme, nightTheme }
  }

  private effectiveName(): string {
    const settings = this.getState()
    if (settings.themeMode === 'manual') return settings.manualTheme
    return nativeTheme.shouldUseDarkColors ? settings.nightTheme : settings.dayTheme
  }

  /** 只允许简单文件名，防路径越界 */
  private safeThemePath(name: string): string {
    const safe = name.replace(/[^a-zA-Z0-9_-]/g, '')
    return join(this.themesDir, `${safe}.css`)
  }

  async listThemes(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.themesDir)
      return files
        .filter((f) => f.toLowerCase().endsWith('.css'))
        .map((f) => f.replace(/\.css$/i, ''))
        .sort()
    } catch {
      return ['light', 'dark']
    }
  }

  /** 当前有效主题的名字与 CSS 文本；读不到则回退内置浅色 */
  async currentCss(): Promise<ThemePayload> {
    const name = this.effectiveName()
    try {
      const css = await fs.readFile(this.safeThemePath(name), 'utf-8')
      return { name, css }
    } catch {
      return { name: 'light', css: BUILTIN.light }
    }
  }

  async select(name: string): Promise<void> {
    await this.settingsStore.update({ themeMode: 'manual', manualTheme: name })
    this.onChange()
  }

  async setMode(patch: Partial<ThemeSettings>): Promise<void> {
    await this.settingsStore.update(patch)
    this.onChange()
  }

  /** 手动重新扫描主题夹（触发菜单重建与主题重推） */
  rescan(): void {
    this.onChange()
  }

  openFolder(): void {
    void shell.openPath(this.themesDir)
  }
}
