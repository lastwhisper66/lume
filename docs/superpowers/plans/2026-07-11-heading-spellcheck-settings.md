# Heading Backspace, Spellcheck, and Settings Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Backspace lower heading levels one step at a time, add a persistent spellcheck language menu with `franc-min` auto-detection, and persist sidebar visibility without overwriting theme settings.

**Architecture:** A single main-process `SettingsStore` owns `settings.json` and supplies theme, spellcheck, and sidebar settings. A main-process spellcheck controller validates Electron dictionaries and applies the selected mode. Renderer state hydrates through preload IPC, runs debounced `franc-min` detection on ProseMirror plain text, and renders an accessible status-bar popover. Heading behavior remains structural: keymap commands transform heading nodes while syntax markers remain non-editable decorations.

**Tech Stack:** Electron 39, React 19, TypeScript 5.9, ProseMirror, Zustand, `franc-min`, Vitest, CSS.

---

## File structure

- Create `src/shared/settings.ts`: shared settings types, defaults, validation, and patch merging.
- Create `src/main/settings.ts`: serialized JSON file persistence with change listeners.
- Modify `src/main/theme.ts`: consume `SettingsStore` instead of writing `settings.json` directly.
- Create `src/main/spellcheck.ts`: Electron session adapter, language matching, and spellcheck mode application.
- Modify `src/main/index.ts`: initialize settings/spellcheck and register IPC handlers.
- Modify `src/preload/index.ts`: expose typed settings and spellcheck APIs.
- Modify `tsconfig.node.json` and `tsconfig.web.json`: include `src/shared/**/*`.
- Create `src/renderer/src/store/settings.ts`: renderer settings snapshot and async actions.
- Modify `src/renderer/src/App.tsx`: hydrate settings and persist sidebar visibility.
- Create `src/renderer/src/components/Editor/headingCommands.test.ts`: heading regression tests.
- Modify `src/renderer/src/components/Editor/commands.ts`: heading Backspace and ArrowLeft commands.
- Create `src/renderer/src/components/StatusBar/languageDetection.ts`: plain-text extraction, `franc-min`, and ISO mapping.
- Create `src/renderer/src/components/StatusBar/languageDetection.test.ts`: detector tests.
- Create `src/renderer/src/components/StatusBar/SpellcheckMenu.tsx`: searchable radio menu.
- Modify `src/renderer/src/components/StatusBar/StatusBar.tsx`: spellcheck button, menu, and auto-detection scheduling.
- Modify `src/renderer/src/styles/structure.css`: status bar right group and popover styling.
- Create `src/main/settings.test.ts`: normalization and persistence tests.
- Create `src/main/spellcheck.test.ts`: dictionary matching and mode application tests.
- Modify `package.json` and `package-lock.json`: add `franc-min`, Vitest, and test scripts.

## Task 1: Add the test runner and language detector dependency

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```powershell
npm install franc-min
npm install --save-dev vitest
```

Expected: `franc-min` appears in `dependencies`, `vitest` appears in `devDependencies`, and the lockfile updates without peer dependency errors.

- [ ] **Step 2: Add test scripts**

Add these entries to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Verify the empty test command starts successfully**

Run:

```powershell
npm test -- --passWithNoTests
```

Expected: exit code 0 with no test failures.

- [ ] **Step 4: Commit dependency setup**

```powershell
git add package.json package-lock.json
git commit -m "test: add vitest and language detection dependency"
```

## Task 2: Reproduce and fix heading marker keyboard behavior

**Files:**
- Create: `src/renderer/src/components/Editor/headingCommands.test.ts`
- Modify: `src/renderer/src/components/Editor/commands.ts`

- [ ] **Step 1: Write failing heading-level regression tests**

Create `headingCommands.test.ts` with helpers that build a one-block document and dispatch commands:

```ts
import { describe, expect, it } from 'vitest'
import { TextSelection, EditorState } from 'prosemirror-state'
import { history, undo } from 'prosemirror-history'
import { schema } from './schema/gfm'
import { keepHeadingCaretAtStart, lowerHeadingLevel } from './commands'

function headingState(level: number): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level }, [schema.text('Heading')])
  ])
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, 1),
    plugins: [history()]
  })
}

function runCommand(state: EditorState, command: typeof lowerHeadingLevel): EditorState {
  let next = state
  expect(command(state, (tr) => (next = state.apply(tr)))).toBe(true)
  return next
}

describe('heading marker keyboard commands', () => {
  it.each([
    [6, 'heading', 5],
    [5, 'heading', 4],
    [4, 'heading', 3],
    [3, 'heading', 2],
    [2, 'heading', 1],
    [1, 'paragraph', null]
  ] as const)('lowers H%s by one marker', (level, type, expectedLevel) => {
    const next = runCommand(headingState(level), lowerHeadingLevel)
    expect(next.doc.firstChild?.type.name).toBe(type)
    expect(next.doc.firstChild?.attrs.level ?? null).toBe(expectedLevel)
    expect(next.doc.firstChild?.textContent).toBe('Heading')
    expect(next.selection.from).toBe(1)
  })

  it('does not run away from the start of a heading', () => {
    const initial = headingState(3)
    const moved = initial.apply(initial.tr.setSelection(TextSelection.create(initial.doc, 3)))
    expect(lowerHeadingLevel(moved)).toBe(false)
    expect(keepHeadingCaretAtStart(moved)).toBe(false)
  })

  it('consumes ArrowLeft at the revealed marker boundary without changing the document', () => {
    const state = headingState(2)
    expect(keepHeadingCaretAtStart(state)).toBe(true)
    expect(state.doc.firstChild?.attrs.level).toBe(2)
  })

  it('can undo a heading level change', () => {
    let state = runCommand(headingState(3), lowerHeadingLevel)
    expect(state.doc.firstChild?.attrs.level).toBe(2)
    expect(undo(state, (tr) => (state = state.apply(tr)))).toBe(true)
    expect(state.doc.firstChild?.attrs.level).toBe(3)
  })
})
```

- [ ] **Step 2: Run the test and confirm it fails for missing exports**

Run:

```powershell
npx vitest run src/renderer/src/components/Editor/headingCommands.test.ts
```

Expected: FAIL because `lowerHeadingLevel` and `keepHeadingCaretAtStart` do not exist.

- [ ] **Step 3: Implement the minimal structural commands**

Add to `commands.ts` before `keymapBindings`:

```ts
function isAtHeadingStart(state: Parameters<Command>[0]): boolean {
  const { selection } = state
  return (
    selection.empty &&
    selection.$from.parent.type === schema.nodes.heading &&
    selection.$from.parentOffset === 0
  )
}

export const lowerHeadingLevel: Command = (state, dispatch) => {
  if (!isAtHeadingStart(state)) return false
  const level = state.selection.$from.parent.attrs.level as number
  const command =
    level > 1
      ? setBlockType(schema.nodes.heading, { level: level - 1 })
      : setBlockType(schema.nodes.paragraph)
  return command(state, dispatch)
}

export const keepHeadingCaretAtStart: Command = (state) => isAtHeadingStart(state)
```

Add these bindings before the formatting shortcuts:

```ts
'Backspace': lowerHeadingLevel,
'ArrowLeft': keepHeadingCaretAtStart,
```

The existing custom keymap plugin already runs before `baseKeymap`, so returning `false` preserves normal behavior elsewhere.

- [ ] **Step 4: Run the targeted regression test**

Run:

```powershell
npx vitest run src/renderer/src/components/Editor/headingCommands.test.ts
```

Expected: all heading command tests pass.

- [ ] **Step 5: Commit the heading fix**

```powershell
git add src/renderer/src/components/Editor/commands.ts src/renderer/src/components/Editor/headingCommands.test.ts
git commit -m "fix: lower heading level from revealed marker"
```

## Task 3: Create one validated settings model and serialized file store

**Files:**
- Create: `src/shared/settings.ts`
- Create: `src/main/settings.ts`
- Create: `src/main/settings.test.ts`
- Modify: `tsconfig.node.json`
- Modify: `tsconfig.web.json`

- [ ] **Step 1: Include shared sources in both TypeScript projects**

Add `"src/shared/**/*"` to the `include` arrays in `tsconfig.node.json` and `tsconfig.web.json`.

- [ ] **Step 2: Write failing normalization and persistence tests**

Create `src/main/settings.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
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
```

- [ ] **Step 3: Run the settings test and confirm missing modules fail**

Run:

```powershell
npx vitest run src/main/settings.test.ts
```

Expected: FAIL because the shared model and store do not exist.

- [ ] **Step 4: Implement the shared settings model**

Create `src/shared/settings.ts` with:

```ts
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  themeMode: 'system',
  manualTheme: 'light',
  dayTheme: 'light',
  nightTheme: 'dark',
  spellcheck: { mode: 'auto', language: null, detectedLanguage: null },
  sidebarVisible: false
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function normalizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const spell =
    raw.spellcheck && typeof raw.spellcheck === 'object'
      ? (raw.spellcheck as Record<string, unknown>)
      : {}
  const mode = spell.mode === 'off' || spell.mode === 'language' ? spell.mode : 'auto'
  return {
    themeMode: raw.themeMode === 'manual' ? 'manual' : 'system',
    manualTheme: stringOr(raw.manualTheme, DEFAULT_SETTINGS.manualTheme),
    dayTheme: stringOr(raw.dayTheme, DEFAULT_SETTINGS.dayTheme),
    nightTheme: stringOr(raw.nightTheme, DEFAULT_SETTINGS.nightTheme),
    spellcheck: {
      mode,
      language: nullableString(spell.language),
      detectedLanguage: nullableString(spell.detectedLanguage)
    },
    sidebarVisible: raw.sidebarVisible === true
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
```

- [ ] **Step 5: Implement serialized persistence**

Create `src/main/settings.ts` with a `SettingsStore` that accepts a file path, loads `normalizeSettings(JSON.parse(raw))`, exposes `getState()`, and serializes `update()` calls through a promise queue:

```ts
import { promises as fs } from 'node:fs'
import type { AppSettings, SettingsPatch } from '../shared/settings'
import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings } from '../shared/settings'

export class SettingsStore {
  private state: AppSettings = normalizeSettings(DEFAULT_SETTINGS)
  private writeQueue: Promise<void> = Promise.resolve()

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

  update(patch: SettingsPatch): Promise<AppSettings> {
    this.state = mergeSettings(this.state, patch)
    const snapshot = this.getState()
    this.writeQueue = this.writeQueue
      .catch(() => undefined)
      .then(() => fs.writeFile(this.file, JSON.stringify(snapshot, null, 2), 'utf8'))
    return this.writeQueue.then(() => this.getState())
  }
}
```

- [ ] **Step 6: Run settings tests**

Run:

```powershell
npx vitest run src/main/settings.test.ts
```

Expected: all settings tests pass.

- [ ] **Step 7: Commit settings infrastructure**

```powershell
git add src/shared/settings.ts src/main/settings.ts src/main/settings.test.ts tsconfig.node.json tsconfig.web.json
git commit -m "feat: centralize application settings persistence"
```

## Task 4: Move theme writes onto the shared SettingsStore

**Files:**
- Modify: `src/main/theme.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Refactor `ThemeManager` construction**

Remove `settingsFile`, `readSettings`, `writeSettings`, and the local `settings` field from `ThemeManager`. Accept `SettingsStore` in the constructor:

```ts
constructor(private readonly settingsStore: SettingsStore) {}
```

Replace theme state reads with:

```ts
getState(): ThemeSettings {
  const { themeMode, manualTheme, dayTheme, nightTheme } = this.settingsStore.getState()
  return { themeMode, manualTheme, dayTheme, nightTheme }
}
```

Update `select(name)` to call `settingsStore.update({ themeMode: 'manual', manualTheme: name })`. Update `setMode(patch)` to call `settingsStore.update(patch)`. Await each write before `onChange()`. Keep theme CSS creation, scanning, system-mode listening, and fallback rendering unchanged.

- [ ] **Step 2: Initialize one settings store in the main process**

In `src/main/index.ts`, create:

```ts
const settingsStore = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
const themeManager = new ThemeManager(settingsStore)
```

Call `await settingsStore.init()` before `themeManager.init(() => void pushTheme())`.

- [ ] **Step 3: Verify legacy theme values survive new writes**

Run:

```powershell
npx vitest run src/main/settings.test.ts
npm run typecheck:node
```

Expected: tests and node typecheck pass.

- [ ] **Step 4: Commit theme integration**

```powershell
git add src/main/theme.ts src/main/index.ts
git commit -m "refactor: persist theme through shared settings store"
```

## Task 5: Add main-process spellcheck control and IPC

**Files:**
- Create: `src/main/spellcheck.ts`
- Create: `src/main/spellcheck.test.ts`
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Write failing dictionary matching tests**

Test a pure `chooseDictionary` function and a fake session:

```ts
import { describe, expect, it } from 'vitest'
import { chooseDictionary } from './spellcheck'

describe('chooseDictionary', () => {
  const available = ['en-US', 'en-GB', 'zh-CN', 'ja']

  it('prefers the matching system locale', () => {
    expect(chooseDictionary('en', available, ['en-GB', 'zh-CN'], ['en-US'])).toBe('en-GB')
  })

  it('keeps a currently enabled matching locale', () => {
    expect(chooseDictionary('en', available, ['fr-FR'], ['en-US'])).toBe('en-US')
  })

  it('returns null when no dictionary matches the detected base language', () => {
    expect(chooseDictionary('ko', available, ['en-US'], [])).toBeNull()
  })
})
```

- [ ] **Step 2: Run the spellcheck test and confirm it fails**

Run:

```powershell
npx vitest run src/main/spellcheck.test.ts
```

Expected: FAIL because `spellcheck.ts` does not exist.

- [ ] **Step 3: Implement language matching and controller**

Create `src/main/spellcheck.ts` with:

```ts
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

export function chooseDictionary(
  detectedBase: string,
  available: string[],
  preferredLocales: string[],
  current: string[]
): string | null {
  const candidates = available.filter((code) => baseLanguage(code) === detectedBase.toLowerCase())
  if (candidates.length === 0) return null
  const preferred = preferredLocales.find((locale) =>
    candidates.some((candidate) => candidate.toLowerCase() === locale.toLowerCase())
  )
  if (preferred) return candidates.find((code) => code.toLowerCase() === preferred.toLowerCase()) ?? null
  const enabled = current.find((code) => candidates.includes(code))
  return enabled ?? candidates[0]
}
```

Add `SpellcheckController` methods:

- `snapshot()` returns settings plus sorted available languages and actual language.
- `apply()` enables/disables the session and validates manual/detected codes.
- `setMode(mode, language?)` persists a normalized spellcheck patch, applies it, and returns a snapshot.
- `submitDetectedBaseLanguage(base)` chooses a concrete available dictionary, persists only reliable matches, applies it, and returns a snapshot.

Use `app.getPreferredSystemLanguages()` in `src/main/index.ts` and inject that list into the controller so tests remain Electron-independent.

- [ ] **Step 4: Register IPC handlers**

Add handlers after app readiness:

```ts
ipcMain.handle('settings:current', () => spellcheckController.snapshot())
ipcMain.handle('settings:setSidebarVisible', async (_event, visible: boolean) => {
  await settingsStore.update({ sidebarVisible: visible === true })
  return spellcheckController.snapshot()
})
ipcMain.handle('spellcheck:setMode', (_event, mode, language) =>
  spellcheckController.setMode(mode, language)
)
ipcMain.handle('spellcheck:detected', (_event, baseLanguage) =>
  spellcheckController.submitDetectedBaseLanguage(baseLanguage)
)
```

Initialize the controller with `session.defaultSession`, call `apply()` before showing the first window, and broadcast `settings:changed` after mutations.

- [ ] **Step 5: Expose the APIs through preload**

Add a `settings` namespace to `window.api`:

```ts
settings: {
  current: () => ipcRenderer.invoke('settings:current'),
  setSidebarVisible: (visible: boolean) =>
    ipcRenderer.invoke('settings:setSidebarVisible', visible),
  setSpellcheckMode: (mode: 'auto' | 'off' | 'language', language?: string) =>
    ipcRenderer.invoke('spellcheck:setMode', mode, language),
  submitDetectedLanguage: (baseLanguage: string) =>
    ipcRenderer.invoke('spellcheck:detected', baseLanguage),
  onChanged: (cb) => {
    const listener = (_event, snapshot) => cb(snapshot)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  }
}
```

Export explicit `SettingsSnapshot` and `SpellcheckSnapshot` interfaces from preload so renderer code receives stable types.

- [ ] **Step 6: Run spellcheck and node checks**

Run:

```powershell
npx vitest run src/main/spellcheck.test.ts src/main/settings.test.ts
npm run typecheck:node
```

Expected: tests and node typecheck pass.

- [ ] **Step 7: Commit main-process spellcheck support**

```powershell
git add src/main/spellcheck.ts src/main/spellcheck.test.ts src/main/index.ts src/preload/index.ts
git commit -m "feat: control persistent spellcheck settings"
```

## Task 6: Hydrate renderer settings and persist sidebar visibility

**Files:**
- Create: `src/renderer/src/store/settings.ts`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Create a renderer settings store**

Implement a Zustand store with `snapshot`, `hydrated`, and actions:

```ts
interface RendererSettingsStore {
  snapshot: SettingsSnapshot | null
  hydrated: boolean
  hydrate: () => Promise<void>
  setSidebarVisible: (visible: boolean) => Promise<void>
  setSpellcheckMode: (mode: SpellcheckMode, language?: string) => Promise<void>
  submitDetectedLanguage: (baseLanguage: string) => Promise<void>
}
```

`hydrate()` calls `window.api.settings.current()`, installs exactly one `onChanged` subscription, and stores the normalized main-process snapshot. Async mutation actions replace the local snapshot with the returned snapshot.

- [ ] **Step 2: Replace local sidebar state in `App.tsx`**

Remove `useState(false)` for `sidebarVisible`. Read it from the settings store, call `hydrate()` in a mount effect, and change the toggle to:

```tsx
onToggleSidebar={() => void setSidebarVisible(!sidebarVisible)}
```

Render the existing collapsed default until hydration completes so startup does not briefly show a sidebar the user previously hid.

- [ ] **Step 3: Run renderer typecheck**

Run:

```powershell
npm run typecheck:web
```

Expected: renderer and preload types compile.

- [ ] **Step 4: Commit sidebar persistence**

```powershell
git add src/renderer/src/store/settings.ts src/renderer/src/App.tsx
git commit -m "feat: persist sidebar visibility"
```

## Task 7: Add reliable `franc-min` document language detection

**Files:**
- Create: `src/renderer/src/components/StatusBar/languageDetection.ts`
- Create: `src/renderer/src/components/StatusBar/languageDetection.test.ts`

- [ ] **Step 1: Write detector tests**

Cover long English, Mandarin Chinese, Japanese, short input, and ambiguous input:

```ts
import { describe, expect, it } from 'vitest'
import { detectDocumentLanguage } from './languageDetection'

describe('detectDocumentLanguage', () => {
  it('detects English', () => {
    expect(
      detectDocumentLanguage(
        'All human beings are born free and equal in dignity and rights. They are endowed with reason and conscience.'
      )
    ).toBe('en')
  })

  it('detects Mandarin Chinese', () => {
    expect(
      detectDocumentLanguage(
        '人人生而自由，在尊严和权利上一律平等。他们赋有理性和良心，并应以兄弟关系的精神相对待。'
      )
    ).toBe('zh')
  })

  it('detects Japanese', () => {
    expect(
      detectDocumentLanguage(
        'すべての人間は、生まれながらにして自由であり、かつ、尊厳と権利とについて平等である。'
      )
    ).toBe('ja')
  })

  it('rejects text that is too short', () => {
    expect(detectDocumentLanguage('hello')).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests and confirm missing module failure**

Run:

```powershell
npx vitest run src/renderer/src/components/StatusBar/languageDetection.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement plain-text detection**

Use `francAll` with `minLength: 40`. Require the top result to be non-`und` and at least `0.1` ahead of the second result. Define the complete `franc-min` mapping as:

```ts
const FRANC_TO_BCP47 = Object.freeze<Record<string, string>>({
  cmn: 'zh', spa: 'es', eng: 'en', rus: 'ru', arb: 'ar', ben: 'bn', hin: 'hi',
  por: 'pt', ind: 'id', jpn: 'ja', fra: 'fr', deu: 'de', jav: 'jv', kor: 'ko',
  tel: 'te', vie: 'vi', mar: 'mr', ita: 'it', tam: 'ta', tur: 'tr', urd: 'ur',
  guj: 'gu', pol: 'pl', ukr: 'uk', kan: 'kn', mai: 'mai', mal: 'ml', pes: 'fa',
  mya: 'my', swh: 'sw', sun: 'su', ron: 'ro', pan: 'pa', bho: 'bho', amh: 'am',
  hau: 'ha', fuv: 'ff', bos: 'bs', hrv: 'hr', nld: 'nl', srp: 'sr', tha: 'th',
  ckb: 'ckb', yor: 'yo', uzn: 'uz', zlm: 'ms', ibo: 'ig', npi: 'ne', ceb: 'ceb',
  skr: 'skr', tgl: 'tl', hun: 'hu', azj: 'az', sin: 'si', koi: 'koi', ell: 'el',
  ces: 'cs', mag: 'mag', run: 'rn', bel: 'be', plt: 'mg', qug: 'qu', mad: 'mad',
  nya: 'ny', zyb: 'za', pbu: 'ps', kin: 'rw', zul: 'zu', bul: 'bg', swe: 'sv',
  lin: 'ln', som: 'so', hms: 'hms', hnj: 'hmn', ilo: 'ilo', kaz: 'kk'
})
```

Codes without an ISO 639-1 equivalent remain valid three-letter BCP 47 language tags. If Electron exposes no matching dictionary, the main process keeps the previous reliable language.

The exported functions are:

```ts
export function documentText(doc: PMNode | undefined): string {
  return doc?.textBetween(0, doc.content.size, '\n', '\n').replace(/\s+/g, ' ').trim() ?? ''
}

export function detectDocumentLanguage(text: string): string | null
```

`detectDocumentLanguage` catches detector exceptions and returns `null`; it never mutates settings directly.

- [ ] **Step 4: Run detector tests**

Run:

```powershell
npx vitest run src/renderer/src/components/StatusBar/languageDetection.test.ts
```

Expected: all detector tests pass.

- [ ] **Step 5: Commit auto-detection module**

```powershell
git add src/renderer/src/components/StatusBar/languageDetection.ts src/renderer/src/components/StatusBar/languageDetection.test.ts
git commit -m "feat: detect document language with franc-min"
```

## Task 8: Build the searchable spellcheck menu

**Files:**
- Create: `src/renderer/src/components/StatusBar/SpellcheckMenu.tsx`
- Modify: `src/renderer/src/components/StatusBar/StatusBar.tsx`
- Modify: `src/renderer/src/styles/structure.css`

- [ ] **Step 1: Implement language display helpers**

Inside `SpellcheckMenu.tsx`, create `displayLanguage(code)` using `Intl.DisplayNames(['zh-CN'], { type: 'language' })` with a code fallback. Normalize codes for display with `code.toUpperCase()`.

- [ ] **Step 2: Implement the menu component**

The component accepts:

```ts
interface SpellcheckMenuProps {
  snapshot: SettingsSnapshot
  onSelectMode: (mode: SpellcheckMode, language?: string) => void
  onClose: () => void
}
```

Render:

- an autofocus search input with placeholder `搜索拼写检查语言`;
- radio option `自动检测语言`, with the actual language on the right;
- radio option `不使用拼写检查`;
- a separator;
- filtered language radio options using `snapshot.availableLanguages`.

Use `role="menu"`, `role="menuitemradio"`, `aria-checked`, and real buttons. Stop pointer propagation inside the popover. Close on Escape and after selection.

- [ ] **Step 3: Integrate menu and debounced auto-detection in `StatusBar.tsx`**

Keep the existing word count. Add:

- settings snapshot/actions from the renderer store;
- `menuOpen` local state and a wrapper ref;
- outside-click and Escape listeners while open;
- a 700 ms effect keyed by `doc` and spellcheck mode;
- `documentText(doc)` followed by `detectDocumentLanguage(text)`;
- submission only when a reliable base language differs from the last submitted value.

Render the right side as:

```tsx
<div className="status-actions">
  <div className="spellcheck-control" ref={spellcheckRef}>
    <button
      className="spellcheck-toggle"
      type="button"
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      title={spellcheckTitle}
      onClick={() => setMenuOpen((open) => !open)}
    >
      ✓ 拼写检查
    </button>
    {menuOpen && snapshot && (
      <SpellcheckMenu
        snapshot={snapshot}
        onSelectMode={(mode, language) => void setSpellcheckMode(mode, language)}
        onClose={() => setMenuOpen(false)}
      />
    )}
  </div>
  <span className="word-count">{words} 词</span>
</div>
```

When mode is off, use `拼写检查已关闭`; in auto mode the title includes the current actual language; in manual mode it includes the selected language.

- [ ] **Step 4: Add menu styling**

Update `.status-bar` to keep the sidebar toggle on the left and introduce `.status-actions` on the right. Add theme-variable-driven rules for:

- `.spellcheck-control { position: relative; }`
- `.spellcheck-toggle`
- `.spellcheck-menu` positioned above the status bar and right-aligned
- `.spellcheck-search`
- `.spellcheck-options` with a fixed max-height and vertical scrolling
- `.spellcheck-option`, hover, checked, and focus-visible states
- `.spellcheck-code` aligned right
- `.spellcheck-separator`

Use `var(--lume-bg-elevated)`, `var(--lume-border-strong)`, `var(--lume-bg-hover)`, `var(--lume-text)`, `var(--lume-text-muted)`, and `var(--lume-accent)` so custom themes remain compatible.

- [ ] **Step 5: Run renderer tests and typecheck**

Run:

```powershell
npx vitest run src/renderer/src/components/StatusBar/languageDetection.test.ts
npm run typecheck:web
```

Expected: tests pass and TypeScript reports no errors.

- [ ] **Step 6: Commit the status-bar UI**

```powershell
git add src/renderer/src/components/StatusBar/SpellcheckMenu.tsx src/renderer/src/components/StatusBar/StatusBar.tsx src/renderer/src/styles/structure.css
git commit -m "feat: add spellcheck language menu"
```

## Task 9: Full verification and manual Electron checks

**Files:**
- Modify only if verification exposes a defect.

- [ ] **Step 1: Run the complete automated test suite**

Run:

```powershell
npm test
```

Expected: all settings, spellcheck, language detection, and heading tests pass with zero failures.

- [ ] **Step 2: Run static checks**

Run:

```powershell
npm run lint
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Build the production application**

Run:

```powershell
npm run build
```

Expected: Electron main, preload, and renderer bundles build successfully. Confirm the renderer bundle contains `franc-min` without CommonJS/ESM warnings.

- [ ] **Step 4: Verify heading behavior in the running app**

Run:

```powershell
npm run dev
```

Open a Markdown file containing H1 through H6 and verify:

1. Put the caret at the beginning of H6 and press Backspace repeatedly: H6 → H5 → H4 → H3 → H2 → H1 → paragraph.
2. Undo repeatedly and confirm each level returns in reverse order.
3. At the heading start, press ArrowLeft and confirm the caret does not flash before the revealed marker.
4. Away from the heading start, Backspace and ArrowLeft retain their normal behavior.
5. Save and inspect the Markdown file to confirm the serialized number of `#` characters matches the final heading level.

- [ ] **Step 5: Verify spellcheck and persistence in the running app**

Verify:

1. The spellcheck button appears immediately left of the word count.
2. The menu matches the confirmed reference layout, searches by localized name and code, and scrolls through all Electron-supported languages.
3. `不使用拼写检查` removes misspelling underlines.
4. Selecting `English (US)` or another available language applies it immediately.
5. Automatic mode detects long English, Chinese, and Japanese samples and shows the actual dictionary beside the auto option.
6. Short or ambiguous text retains the previous reliable dictionary.
7. Restart the app and confirm spellcheck mode/language and sidebar visibility are restored.
8. Change themes after changing sidebar/spellcheck settings, restart, and confirm none of the settings overwrote each other.

- [ ] **Step 6: Inspect the final diff and working tree**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only intentional changes are present.

## Plan self-review

- Spec coverage: heading decrement, ArrowLeft stabilization, `franc-min`, search menu, Electron language list, three spellcheck modes, unified settings persistence, legacy theme preservation, and sidebar visibility are each assigned to a task.
- Placeholder scan: implementation steps name concrete files, commands, behaviors, and expected results; no deferred feature work remains.
- Type consistency: `SpellcheckMode`, `AppSettings`, `SettingsPatch`, and preload snapshot types originate from the shared/preload contracts and are reused by main and renderer code.
