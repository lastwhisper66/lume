import { promises as fs } from 'node:fs'
import type { AppSettings, SettingsPatch } from '../shared/settings'
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from '../shared/settings'

type SettingsListener = (settings: AppSettings) => void

export class SettingsStore {
  private state: AppSettings = normalizeSettings(DEFAULT_SETTINGS)
  private writeQueue: Promise<void> = Promise.resolve()
  private listeners = new Set<SettingsListener>()

  constructor(private readonly file: string) {}

  async init(): Promise<void> {
    try {
      this.state = normalizeSettings(JSON.parse(await fs.readFile(this.file, 'utf8')))
    } catch {
      this.state = normalizeSettings(DEFAULT_SETTINGS)
    }
  }

  getState(): AppSettings {
    return structuredClone(this.state)
  }

  onChange(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(patch: SettingsPatch): Promise<AppSettings> {
    this.state = mergeSettings(this.state, patch)
    const snapshot = this.getState()
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => fs.writeFile(this.file, JSON.stringify(snapshot, null, 2), 'utf8'))
    return this.writeQueue.then(() => {
      const saved = this.getState()
      for (const listener of this.listeners) listener(saved)
      return saved
    })
  }
}
