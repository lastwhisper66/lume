import { app, nativeTheme, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import lightCss from '../../resources/themes/light.css?raw'
import darkCss from '../../resources/themes/dark.css?raw'

export interface ThemeSettings {
  themeMode: 'system' | 'manual'
  manualTheme: string
  dayTheme: string
  nightTheme: string
}

export interface ThemePayload {
  name: string
  css: string
}

const DEFAULT_SETTINGS: ThemeSettings = {
  themeMode: 'system',
  manualTheme: 'light',
  dayTheme: 'light',
  nightTheme: 'dark'
}

const BUILTIN: Record<string, string> = { light: lightCss, dark: darkCss }

export class ThemeManager {
  private themesDir = join(app.getPath('userData'), 'themes')
  private settingsFile = join(app.getPath('userData'), 'settings.json')
  private settings: ThemeSettings = { ...DEFAULT_SETTINGS }
  private onChange: () => void = () => {}

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
    this.settings = await this.readSettings()
    nativeTheme.on('updated', () => {
      if (this.settings.themeMode === 'system') this.onChange()
    })
  }

  private async readSettings(): Promise<ThemeSettings> {
    try {
      const raw = await fs.readFile(this.settingsFile, 'utf-8')
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<ThemeSettings>) }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  private async writeSettings(): Promise<void> {
    await fs.writeFile(this.settingsFile, JSON.stringify(this.settings, null, 2), 'utf-8')
  }

  getState(): ThemeSettings {
    return this.settings
  }

  private effectiveName(): string {
    if (this.settings.themeMode === 'manual') return this.settings.manualTheme
    return nativeTheme.shouldUseDarkColors ? this.settings.nightTheme : this.settings.dayTheme
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
    this.settings.themeMode = 'manual'
    this.settings.manualTheme = name
    await this.writeSettings()
    this.onChange()
  }

  async setMode(patch: Partial<ThemeSettings>): Promise<void> {
    this.settings = { ...this.settings, ...patch }
    await this.writeSettings()
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
