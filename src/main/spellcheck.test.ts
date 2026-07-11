import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsStore } from './settings'
import { chooseDictionary, SpellcheckController } from './spellcheck'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('chooseDictionary', () => {
  const available = ['en-US', 'en-GB', 'zh-CN', 'ja']

  it('prefers the matching system locale', () => {
    expect(chooseDictionary('en', available, ['en-GB', 'zh-CN'], ['en-US'])).toBe('en-GB')
  })

  it('keeps a currently enabled matching locale', () => {
    expect(chooseDictionary('en', available, ['fr-FR'], ['en-US'])).toBe('en-US')
  })

  it('falls back to the first matching available dictionary', () => {
    expect(chooseDictionary('en', available, ['fr-FR'], [])).toBe('en-US')
  })

  it('returns null when no dictionary matches the detected base language', () => {
    expect(chooseDictionary('ko', available, ['en-US'], [])).toBeNull()
  })
})

describe('SpellcheckController', () => {
  it('applies off, manual, and detected automatic modes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lume-spellcheck-'))
    dirs.push(dir)
    const settings = new SettingsStore(join(dir, 'settings.json'))
    await settings.init()

    const fakeSession = {
      availableSpellCheckerLanguages: ['en-US', 'zh-CN', 'ja'],
      languages: ['en-US'],
      enabled: true,
      getSpellCheckerLanguages(): string[] {
        return this.languages
      },
      setSpellCheckerEnabled(enabled: boolean): void {
        this.enabled = enabled
      },
      setSpellCheckerLanguages(languages: string[]): void {
        this.languages = languages
      }
    }
    const controller = new SpellcheckController(settings, fakeSession, ['en-US'])

    await controller.setMode('off')
    expect(fakeSession.enabled).toBe(false)

    await controller.setMode('language', 'ja')
    expect(fakeSession.enabled).toBe(true)
    expect(fakeSession.languages).toEqual(['ja'])

    await controller.setMode('auto')
    await controller.submitDetectedBaseLanguage('zh')
    expect(fakeSession.languages).toEqual(['zh-CN'])
    expect(settings.getState().spellcheck.detectedLanguage).toBe('zh-CN')
  })
})
