import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  pushRecent,
  removeRecent,
  RECENTS_MAX
} from './settings'

describe('recents helpers', () => {
  it('defaults recents to empty arrays', () => {
    expect(DEFAULT_SETTINGS.recentFiles).toEqual([])
    expect(DEFAULT_SETTINGS.recentFolders).toEqual([])
    expect(normalizeSettings({})).toMatchObject({ recentFiles: [], recentFolders: [] })
  })

  it('normalizes recents: drops non-strings, dedupes, caps at RECENTS_MAX', () => {
    const many = Array.from({ length: RECENTS_MAX + 10 }, (_, i) => `C:/f${i}.md`)
    const normalized = normalizeSettings({
      recentFiles: ['C:/a.md', 42, '', 'C:/a.md', 'C:/b.md', null, ...many]
    })
    expect(normalized.recentFiles.slice(0, 3)).toEqual(['C:/a.md', 'C:/b.md', 'C:/f0.md'])
    expect(normalized.recentFiles).toHaveLength(RECENTS_MAX)
  })

  it('dedupes case-insensitively, keeping the newest casing', () => {
    expect(normalizeSettings({ recentFolders: ['C:/Work', 'c:/work'] }).recentFolders).toEqual([
      'C:/Work'
    ])
  })

  it('pushRecent moves an existing entry to the front (case-insensitive)', () => {
    expect(pushRecent(['C:/a.md', 'C:/b.md'], 'c:/A.md')).toEqual(['c:/A.md', 'C:/b.md'])
  })

  it('pushRecent prepends new entries and caps the list', () => {
    const list = Array.from({ length: RECENTS_MAX }, (_, i) => `C:/f${i}.md`)
    const next = pushRecent(list, 'C:/new.md')
    expect(next[0]).toBe('C:/new.md')
    expect(next).toHaveLength(RECENTS_MAX)
    expect(next).not.toContain(`C:/f${RECENTS_MAX - 1}.md`)
  })

  it('pushRecent ignores empty paths', () => {
    expect(pushRecent(['C:/a.md'], '')).toEqual(['C:/a.md'])
  })

  it('removeRecent deletes an entry case-insensitively', () => {
    expect(removeRecent(['C:/a.md', 'C:/b.md'], 'c:/A.MD')).toEqual(['C:/b.md'])
  })
})
