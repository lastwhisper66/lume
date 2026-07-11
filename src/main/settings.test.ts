import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeSettings } from '../shared/settings'
import { SettingsStore } from './settings'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('settings', () => {
  it('preserves legacy theme fields while adding new defaults', () => {
    expect(
      normalizeSettings({
        themeMode: 'manual',
        manualTheme: 'paper',
        dayTheme: 'paper',
        nightTheme: 'midnight'
      })
    ).toMatchObject({
      themeMode: 'manual',
      manualTheme: 'paper',
      dayTheme: 'paper',
      nightTheme: 'midnight',
      sidebarVisible: false,
      spellcheck: { mode: 'auto', language: null, detectedLanguage: null }
    })
  })

  it('normalizes invalid spellcheck values', () => {
    expect(
      normalizeSettings({
        spellcheck: { mode: 'unexpected', language: 42, detectedLanguage: '' },
        sidebarVisible: 'yes'
      })
    ).toMatchObject({
      spellcheck: { mode: 'auto', language: null, detectedLanguage: null },
      sidebarVisible: false
    })
  })

  it('serializes concurrent patches without dropping fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lume-settings-'))
    dirs.push(dir)
    const file = join(dir, 'settings.json')
    await writeFile(file, JSON.stringify({ manualTheme: 'paper' }), 'utf8')
    const store = new SettingsStore(file)
    await store.init()
    await Promise.all([
      store.update({ sidebarVisible: true }),
      store.update({ spellcheck: { mode: 'off' } })
    ])
    const saved = JSON.parse(await readFile(file, 'utf8'))
    expect(saved.manualTheme).toBe('paper')
    expect(saved.sidebarVisible).toBe(true)
    expect(saved.spellcheck.mode).toBe('off')
  })
})
