# Unified Contenteditable Headings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the isolated heading textarea with real ATX prefix text inside ProseMirror's existing root contenteditable so keyboard selection reveals headings and crosses them with one arrow-key action.

**Architecture:** Every internal heading node starts with its editable `#{1,6} ` source prefix. Shared helpers add the prefix after Markdown parsing, remove it before Markdown serialization, and expose body-only text to consumers. A normalization plugin maintains the heading/paragraph invariant, while decorations hide inactive prefixes and reveal the active heading without moving focus out of ProseMirror.

**Tech Stack:** TypeScript, ProseMirror model/state/view/inputrules/history, React, Vitest, jsdom, Electron CSS.

---

## File map

- Create `src/renderer/src/components/Editor/headingSource.ts`: ATX parsing, prefix/body extraction, recursive parse/serialize document transforms, body-only document text.
- Create `src/renderer/src/components/Editor/headingSource.test.ts`: helper and Markdown round-trip tests replacing textarea-specific tests.
- Create `src/renderer/src/components/Editor/headingNormalization.ts`: append-transaction plugin that converts valid ATX paragraphs/headings and invalid headings.
- Create `src/renderer/src/components/Editor/headingNormalization.test.ts`: transaction-level normalization tests.
- Modify `src/renderer/src/components/Editor/markdown/parser.ts`: add editable prefixes after parsing.
- Modify `src/renderer/src/components/Editor/markdown/serializer.ts`: strip internal prefixes before serialization.
- Modify `src/renderer/src/components/Editor/inputrules.ts`: preserve typed ATX source when converting a paragraph to a heading.
- Modify `src/renderer/src/components/Editor/commands.ts`: source-aware heading conversion and Enter split commands.
- Create `src/renderer/src/components/Editor/commands.test.ts`: heading split and conversion tests.
- Modify `src/renderer/src/components/Editor/plugins.ts`: register normalization and heading Enter handling in the correct order.
- Modify `src/renderer/src/components/Editor/syntaxReveal.ts`: decorate all heading prefixes and mark the selected heading active.
- Create `src/renderer/src/components/Editor/syntaxReveal.test.ts`: selection-driven prefix reveal tests.
- Modify `src/renderer/src/components/Editor/index.tsx`: remove the heading NodeView registration.
- Delete `src/renderer/src/components/Editor/nodeviews/headingSource.ts`: remove the textarea implementation.
- Delete `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`: remove obsolete textarea integration tests.
- Modify `src/renderer/src/styles/editor.css`: remove textarea/wrapper styles and add active-prefix visibility rules.
- Modify `src/renderer/src/components/Outline/documentInfo.ts`: omit internal prefixes from outline and word count.
- Create `src/renderer/src/components/Outline/documentInfo.test.ts`: body-only outline/count tests.
- Modify `src/renderer/src/components/StatusBar/languageDetection.ts`: omit internal prefixes from language detection input.
- Modify `src/renderer/src/components/StatusBar/languageDetection.test.ts`: test document text cleanup.
- Modify `src/renderer/src/store/workspace.test.ts`: update internal heading expectations while preserving saved Markdown expectations.

### Task 1: Add the internal heading-source model boundary

**Files:**
- Create: `src/renderer/src/components/Editor/headingSource.ts`
- Create: `src/renderer/src/components/Editor/headingSource.test.ts`
- Modify: `src/renderer/src/components/Editor/markdown/parser.ts`
- Modify: `src/renderer/src/components/Editor/markdown/serializer.ts`

- [ ] **Step 1: Write failing helper and round-trip tests**

Create `src/renderer/src/components/Editor/headingSource.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { schema } from './schema/gfm'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import {
  addHeadingPrefixes,
  documentBodyText,
  headingBodyText,
  headingPrefix,
  headingPrefixLength,
  parseAtxHeading,
  stripHeadingPrefixes
} from './headingSource'

describe('heading source helpers', () => {
  it.each([
    ['# Title', { level: 1, prefixLength: 2, body: 'Title' }],
    ['###### Title #2', { level: 6, prefixLength: 7, body: 'Title #2' }],
    ['#NoSpace', null],
    ['####### Title', null]
  ])('parses %j', (source, expected) => {
    expect(parseAtxHeading(source)).toEqual(expected)
  })

  it('creates and locates prefixes', () => {
    expect(headingPrefix(3)).toBe('### ')
    const heading = schema.nodes.heading.create(
      { level: 3 },
      schema.text('### Title')
    )
    expect(headingPrefixLength(heading)).toBe(4)
    expect(headingBodyText(heading)).toBe('Title')
  })

  it('adds and strips prefixes without mutating the source documents', () => {
    const plainHeading = schema.nodes.heading.create({ level: 2 }, schema.text('Title'))
    const plainDoc = schema.node('doc', null, [plainHeading])
    const editableDoc = addHeadingPrefixes(plainDoc)
    const cleanDoc = stripHeadingPrefixes(editableDoc)

    expect(plainDoc.firstChild?.textContent).toBe('Title')
    expect(editableDoc.firstChild?.textContent).toBe('## Title')
    expect(cleanDoc.firstChild?.textContent).toBe('Title')
  })

  it('returns body-only document text', () => {
    const doc = parse('# Heading\n\nParagraph')
    expect(documentBodyText(doc, '\n')).toBe('Heading\nParagraph')
  })
})

describe('heading Markdown boundary', () => {
  it.each(['# One', '### Three', '###### Six #2'])('round-trips %j once', (source) => {
    const doc = parse(source)
    expect(doc.firstChild?.textContent).toBe(source)
    expect(serialize(doc).trimEnd()).toBe(source)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/headingSource.test.ts
```

Expected: FAIL because `headingSource.ts` and the exported helpers do not exist.

- [ ] **Step 3: Implement the shared heading-source helpers**

Create `src/renderer/src/components/Editor/headingSource.ts` with these public functions and recursive transforms:

```ts
import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'

export interface ParsedAtxHeading {
  level: number
  prefixLength: number
  body: string
}

export function parseAtxHeading(source: string): ParsedAtxHeading | null {
  const match = /^(#{1,6})[ \t]+(.*)$/.exec(source)
  if (!match) return null
  return {
    level: match[1].length,
    prefixLength: source.length - match[2].length,
    body: match[2]
  }
}

export function headingPrefix(level: number): string {
  return `${'#'.repeat(Math.max(1, Math.min(6, level)))} `
}

export function headingPrefixLength(node: PMNode): number {
  if (node.type.name !== 'heading') return 0
  return parseAtxHeading(node.textContent)?.prefixLength ?? 0
}

export function headingBodyText(node: PMNode): string {
  if (node.type.name !== 'heading') return node.textContent
  const parsed = parseAtxHeading(node.textContent)
  return parsed?.body ?? node.textContent
}

function mapDocument(node: PMNode, mapHeading: (heading: PMNode) => PMNode): PMNode {
  if (node.type.name === 'heading') return mapHeading(node)
  if (node.isLeaf) return node
  const children: PMNode[] = []
  node.forEach((child) => children.push(mapDocument(child, mapHeading)))
  return node.copy(Fragment.fromArray(children))
}

export function addHeadingPrefixes(doc: PMNode): PMNode {
  return mapDocument(doc, (heading) => {
    if (parseAtxHeading(heading.textContent)) return heading
    const prefix = heading.type.schema.text(headingPrefix(Number(heading.attrs.level)))
    return heading.copy(Fragment.from(prefix).append(heading.content))
  })
}

export function stripHeadingPrefixes(doc: PMNode): PMNode {
  return mapDocument(doc, (heading) => {
    const length = headingPrefixLength(heading)
    return length === 0 ? heading : heading.copy(heading.content.cut(length))
  })
}

export function documentBodyText(doc: PMNode | undefined, blockSeparator: string): string {
  return doc ? stripHeadingPrefixes(doc).textBetween(0, doc.content.size, blockSeparator) : ''
}
```

- [ ] **Step 4: Apply the helpers at the Markdown boundary**

In `markdown/parser.ts`, change the return path to:

```ts
import { addHeadingPrefixes } from '../headingSource'

export function parse(markdown: string): PMNode {
  const doc = parser.parse(markdown)
  if (!doc) throw new Error('Markdown 解析失败')
  return addHeadingPrefixes(applyTaskLists(doc))
}
```

In `markdown/serializer.ts`, clean the internal document before using the existing serializer:

```ts
import { stripHeadingPrefixes } from '../headingSource'

export function serialize(doc: PMNode): string {
  return serializer.serialize(stripHeadingPrefixes(doc))
}
```

- [ ] **Step 5: Run the focused tests**

Run:

```powershell
npm test -- src/renderer/src/components/Editor/headingSource.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the model boundary**

```powershell
git add src/renderer/src/components/Editor/headingSource.ts src/renderer/src/components/Editor/headingSource.test.ts src/renderer/src/components/Editor/markdown/parser.ts src/renderer/src/components/Editor/markdown/serializer.ts
git commit -m "refactor: store editable heading prefixes"
```

### Task 2: Normalize heading source edits inside ProseMirror

**Files:**
- Create: `src/renderer/src/components/Editor/headingNormalization.ts`
- Create: `src/renderer/src/components/Editor/headingNormalization.test.ts`
- Modify: `src/renderer/src/components/Editor/plugins.ts`

- [ ] **Step 1: Write failing transaction-level tests**

Create `headingNormalization.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { parse } from './markdown/parser'
import { headingNormalizationPlugin } from './headingNormalization'

function state(source: string): EditorState {
  return EditorState.create({ doc: parse(source), plugins: [headingNormalizationPlugin] })
}

function dispatch(editorState: EditorState, tr: typeof editorState.tr): EditorState {
  return editorState.apply(tr)
}

describe('heading normalization', () => {
  it('updates the heading level after editing the prefix', () => {
    let editorState = state('# Title')
    editorState = dispatch(editorState, editorState.tr.insertText('##', 1, 2))
    expect(editorState.doc.firstChild?.type.name).toBe('heading')
    expect(editorState.doc.firstChild?.attrs.level).toBe(2)
    expect(editorState.doc.firstChild?.textContent).toBe('## Title')
  })

  it('turns an invalid heading source into a paragraph without losing text', () => {
    let editorState = state('# Title')
    editorState = dispatch(editorState, editorState.tr.delete(2, 3))
    expect(editorState.doc.firstChild?.type.name).toBe('paragraph')
    expect(editorState.doc.firstChild?.textContent).toBe('#Title')
  })

  it('turns a repaired ATX paragraph back into a heading', () => {
    let editorState = state('####### Title')
    editorState = dispatch(editorState, editorState.tr.delete(1, 2))
    expect(editorState.doc.firstChild?.type.name).toBe('heading')
    expect(editorState.doc.firstChild?.attrs.level).toBe(6)
    expect(editorState.doc.firstChild?.textContent).toBe('###### Title')
  })

  it('preserves a text selection while changing the block type', () => {
    let editorState = state('# Title')
    editorState = dispatch(
      editorState,
      editorState.tr
        .setSelection(TextSelection.create(editorState.doc, 4))
        .delete(2, 3)
    )
    expect(editorState.selection.from).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

```powershell
npm test -- src/renderer/src/components/Editor/headingNormalization.test.ts
```

Expected: FAIL because the plugin does not exist.

- [ ] **Step 3: Implement one-pass normalization**

Create `headingNormalization.ts`. The plugin must only inspect changed documents, collect heading/paragraph replacements, apply them from the end of the document toward the start, and tag its own transaction:

```ts
import { Plugin, PluginKey } from 'prosemirror-state'
import type { Node as PMNode } from 'prosemirror-model'
import { parseAtxHeading } from './headingSource'

export const headingNormalizationKey = new PluginKey('headingNormalization')

interface Replacement {
  pos: number
  node: PMNode
}

export const headingNormalizationPlugin = new Plugin({
  key: headingNormalizationKey,
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null
    if (transactions.some((tr) => tr.getMeta(headingNormalizationKey))) return null

    const replacements: Replacement[] = []
    newState.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading' && node.type.name !== 'paragraph') return true
      const parsed = parseAtxHeading(node.textContent)

      if (node.type.name === 'heading' && !parsed) {
        replacements.push({
          pos,
          node: newState.schema.nodes.paragraph.create(null, node.content, node.marks)
        })
      } else if (parsed && (node.type.name !== 'heading' || node.attrs.level !== parsed.level)) {
        replacements.push({
          pos,
          node: newState.schema.nodes.heading.create(
            { level: parsed.level },
            node.content,
            node.marks
          )
        })
      }
      return false
    })

    if (replacements.length === 0) return null
    const tr = newState.tr.setMeta(headingNormalizationKey, true)
    for (const replacement of replacements.reverse()) {
      const current = tr.doc.nodeAt(replacement.pos)
      if (current) tr.replaceWith(replacement.pos, replacement.pos + current.nodeSize, replacement.node)
    }
    return tr
  }
})
```

During implementation, retain inline content and marks exactly; use `replaceWith` rather than recreating plain text. If replacing multiple nodes changes positions, process descending positions as shown.

- [ ] **Step 4: Register normalization before history-dependent UI plugins**

In `plugins.ts`, import `headingNormalizationPlugin` and add it immediately after input rules:

```ts
return [
  buildInputRules(),
  headingNormalizationPlugin,
  keymap(keymapBindings),
  keymap(baseKeymap),
  // existing plugins...
]
```

- [ ] **Step 5: Run normalization and round-trip tests**

```powershell
npm test -- src/renderer/src/components/Editor/headingNormalization.test.ts src/renderer/src/components/Editor/headingSource.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit normalization**

```powershell
git add src/renderer/src/components/Editor/headingNormalization.ts src/renderer/src/components/Editor/headingNormalization.test.ts src/renderer/src/components/Editor/plugins.ts
git commit -m "feat: normalize editable heading source"
```

### Task 3: Make heading commands operate on unified source text

**Files:**
- Modify: `src/renderer/src/components/Editor/inputrules.ts`
- Modify: `src/renderer/src/components/Editor/commands.ts`
- Create: `src/renderer/src/components/Editor/commands.test.ts`
- Modify: `src/renderer/src/components/Editor/plugins.ts`

- [ ] **Step 1: Write failing command tests**

Create `commands.test.ts` with a state helper using `history()` and `headingNormalizationPlugin`, then cover source-preserving conversion and Enter splitting:

```ts
import { describe, expect, it } from 'vitest'
import { history, undo } from 'prosemirror-history'
import { EditorState, TextSelection } from 'prosemirror-state'
import { parse } from './markdown/parser'
import { headingNormalizationPlugin } from './headingNormalization'
import { setHeadingLevel, setParagraph, splitHeading } from './commands'

function createState(source: string): EditorState {
  return EditorState.create({ doc: parse(source), plugins: [headingNormalizationPlugin, history()] })
}

function run(command: typeof splitHeading, state: EditorState): EditorState {
  let next = state
  expect(command(state, (tr) => { next = next.apply(tr) })).toBe(true)
  return next
}

describe('heading commands', () => {
  it('adds the editable prefix when converting a paragraph', () => {
    let state = createState('Title')
    state = run(setHeadingLevel(3), state)
    expect(state.doc.firstChild?.textContent).toBe('### Title')
    expect(state.doc.firstChild?.attrs.level).toBe(3)
  })

  it('changes an existing prefix exactly once', () => {
    let state = createState('# Title')
    state = run(setHeadingLevel(2), state)
    expect(state.doc.firstChild?.textContent).toBe('## Title')
  })

  it('removes the source prefix when explicitly converting to paragraph', () => {
    let state = createState('## Title')
    state = run(setParagraph, state)
    expect(state.doc.firstChild?.type.name).toBe('paragraph')
    expect(state.doc.firstChild?.textContent).toBe('Title')
  })

  it('splits only the heading body and selects the new paragraph', () => {
    let state = createState('# BeforeAfter')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)))
    state = run(splitHeading, state)
    expect(state.doc.child(0).textContent).toBe('# Before')
    expect(state.doc.child(1).textContent).toBe('After')
    expect(state.selection.$from.parent.type.name).toBe('paragraph')
    expect(state.selection.$from.parentOffset).toBe(0)
  })

  it('undoes an Enter split as one history event', () => {
    let state = createState('# BeforeAfter')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 9)))
    state = run(splitHeading, state)
    expect(undo(state, (tr) => { state = state.apply(tr) })).toBe(true)
    expect(state.doc.childCount).toBe(1)
    expect(state.doc.firstChild?.textContent).toBe('# BeforeAfter')
  })
})
```

- [ ] **Step 2: Run the command tests to verify they fail**

```powershell
npm test -- src/renderer/src/components/Editor/commands.test.ts
```

Expected: FAIL because the source-aware commands do not exist.

- [ ] **Step 3: Replace the heading input rule with a source-preserving rule**

In `inputrules.ts`, replace `textblockTypeInputRule` for headings with an `InputRule` that replaces the pre-insert range with the full match and changes the block type without deleting the source prefix:

```ts
const headingRule = new InputRule(/^(#{1,6})\s$/, (state, match, start, end) => {
  const level = match[1].length
  return state.tr
    .insertText(match[0], start, end)
    .setBlockType(start, start + match[0].length, schema.nodes.heading, { level })
})
```

Add an input-rule integration assertion that typing the final space produces `heading(level=1, textContent="# ")`, not an empty heading and not a duplicated prefix.

- [ ] **Step 4: Implement source-aware conversion commands**

In `commands.ts`, export:

```ts
export function setHeadingLevel(level: number): Command
export const setParagraph: Command
export const splitHeading: Command
```

`setHeadingLevel(level)` must operate on the current textblock, replace an existing legal prefix or insert a new one at `$from.start()`, set the block type to heading, clear marks from the prefix range, and place the selection after the same body offset.

`setParagraph` must remove `headingPrefixLength(parent)` characters before changing the node type to paragraph. It must preserve inline body content and selection offsets.

`splitHeading` must return `false` unless both selection endpoints are in the same heading. Its implementation must:

```ts
const node = state.selection.$from.parent
const prefixLength = headingPrefixLength(node)
const fromOffset = Math.max(prefixLength, state.selection.$from.parentOffset)
const toOffset = Math.max(prefixLength, state.selection.$to.parentOffset)
const headingContent = node.content.cut(0, fromOffset)
const paragraphContent = node.content.cut(toOffset)
const heading = node.type.create(node.attrs, headingContent, node.marks)
const paragraph = state.schema.nodes.paragraph.create(null, paragraphContent)
```

Replace the original block with `[heading, paragraph]`, set `TextSelection` to `paragraphPos + 1`, call `closeHistory(tr)`, dispatch, and scroll into view.

Update key bindings:

```ts
'Enter': splitHeading,
'Mod-Shift-1': setHeadingLevel(1),
'Mod-Shift-2': setHeadingLevel(2),
'Mod-Shift-0': setParagraph,
```

- [ ] **Step 5: Verify command and normalization behavior**

```powershell
npm test -- src/renderer/src/components/Editor/commands.test.ts src/renderer/src/components/Editor/headingNormalization.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit command behavior**

```powershell
git add src/renderer/src/components/Editor/inputrules.ts src/renderer/src/components/Editor/commands.ts src/renderer/src/components/Editor/commands.test.ts src/renderer/src/components/Editor/plugins.ts
git commit -m "feat: edit headings in the root contenteditable"
```

### Task 4: Reveal the active prefix through decorations and remove the textarea NodeView

**Files:**
- Modify: `src/renderer/src/components/Editor/syntaxReveal.ts`
- Create: `src/renderer/src/components/Editor/syntaxReveal.test.ts`
- Modify: `src/renderer/src/components/Editor/index.tsx`
- Modify: `src/renderer/src/styles/editor.css`
- Delete: `src/renderer/src/components/Editor/nodeviews/headingSource.ts`
- Delete: `src/renderer/src/components/Editor/nodeviews/headingSource.test.ts`

- [ ] **Step 1: Write failing reveal tests**

Create `syntaxReveal.test.ts` using an `EditorView` with `syntaxRevealPlugin`:

```ts
// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { EditorState, TextSelection } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { parse } from './markdown/parser'
import { syntaxRevealPlugin } from './syntaxReveal'

const views: EditorView[] = []

function createView(source: string): EditorView {
  const mount = document.body.appendChild(document.createElement('div'))
  const view = new EditorView(mount, {
    state: EditorState.create({ doc: parse(source), plugins: [syntaxRevealPlugin] })
  })
  views.push(view)
  return view
}

afterEach(() => {
  views.splice(0).forEach((view) => view.destroy())
  document.body.replaceChildren()
})

describe('heading source reveal', () => {
  it('keeps the prefix in the root contenteditable without a textarea', () => {
    const view = createView('# Title')
    expect(view.dom.textContent).toBe('# Title')
    expect(view.dom.querySelector('textarea')).toBeNull()
    expect(view.dom.querySelector('.heading-source-marker')?.textContent).toBe('# ')
  })

  it('marks the heading active when selection enters by transaction', () => {
    const view = createView('Before\n\n## Title\n\nAfter')
    const headingPos = view.state.doc.child(0).nodeSize
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos + 4)))
    expect(view.dom.querySelector('h2')?.classList.contains('heading-source-active')).toBe(true)
  })

  it('moves the active class when selection leaves the heading', () => {
    const view = createView('# Title\n\nAfter')
    const paragraphPos = view.state.doc.child(0).nodeSize
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, paragraphPos + 1)))
    expect(view.dom.querySelector('h1')?.classList.contains('heading-source-active')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the reveal tests to verify they fail**

```powershell
npm test -- src/renderer/src/components/Editor/syntaxReveal.test.ts
```

Expected: FAIL because no heading prefix decorations or active class exist.

- [ ] **Step 3: Decorate every heading prefix and the selected heading**

In `syntaxReveal.ts`, add a heading traversal before inline mark decorations:

```ts
function headingDecorations(state: EditorState, decos: Decoration[]): void {
  const activeHeadingPos = (() => {
    const { $from } = state.selection
    for (let depth = $from.depth; depth > 0; depth--) {
      if ($from.node(depth).type.name === 'heading') return $from.before(depth)
    }
    return null
  })()

  state.doc.descendants((node, pos) => {
    if (node.type.name !== 'heading') return true
    const prefixLength = headingPrefixLength(node)
    if (prefixLength > 0) {
      decos.push(Decoration.inline(pos + 1, pos + 1 + prefixLength, {
        class: 'heading-source-marker'
      }))
    }
    if (pos === activeHeadingPos) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, {
        class: 'heading-source-active'
      }))
    }
    return false
  })
}
```

Call `headingDecorations(state, decos)` first in the plugin's `decorations` prop.

- [ ] **Step 4: Remove the NodeView and replace its CSS**

In `index.tsx`, remove the `HeadingSourceView` import and the `heading` entry from `nodeViews`.

Delete:

```text
src/renderer/src/components/Editor/nodeviews/headingSource.ts
src/renderer/src/components/Editor/nodeviews/headingSource.test.ts
```

In `editor.css`, remove `.heading-source-wrapper`, `.heading-source-rendered`, and `.heading-source-input`. Add:

```css
.heading-source-marker {
  display: none;
  color: var(--lume-marker);
  font-family: var(--lume-font-mono);
}

.lume-editor .ProseMirror-focused .heading-source-active .heading-source-marker {
  display: inline;
}
```

Do not add ArrowUp or ArrowDown handlers. The absence of a nested textarea/contenteditable is the navigation fix.

- [ ] **Step 5: Run reveal and editor tests**

```powershell
npm test -- src/renderer/src/components/Editor/syntaxReveal.test.ts src/renderer/src/components/Editor/headingSource.test.ts src/renderer/src/components/Editor/commands.test.ts
```

Expected: PASS and no test queries `.heading-source-input`.

- [ ] **Step 6: Commit unified selection rendering**

```powershell
git add src/renderer/src/components/Editor/syntaxReveal.ts src/renderer/src/components/Editor/syntaxReveal.test.ts src/renderer/src/components/Editor/index.tsx src/renderer/src/styles/editor.css
git add -u src/renderer/src/components/Editor/nodeviews
git commit -m "fix: keep heading navigation in one contenteditable"
```

### Task 5: Remove internal prefixes from outline, counting, and language text

**Files:**
- Modify: `src/renderer/src/components/Outline/documentInfo.ts`
- Create: `src/renderer/src/components/Outline/documentInfo.test.ts`
- Modify: `src/renderer/src/components/StatusBar/languageDetection.ts`
- Modify: `src/renderer/src/components/StatusBar/languageDetection.test.ts`
- Modify: `src/renderer/src/store/workspace.test.ts`

- [ ] **Step 1: Write failing consumer tests**

Create `documentInfo.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parse } from '../Editor/markdown/parser'
import { countWords, extractOutline } from './documentInfo'

describe('heading text consumers', () => {
  it('omits the editable prefix from outline entries', () => {
    expect(extractOutline(parse('### Heading'))).toEqual([
      { text: 'Heading', level: 3, pos: 0 }
    ])
  })

  it('does not count heading source as content', () => {
    expect(countWords(parse('# One heading'))).toBe(2)
  })
})
```

Extend `languageDetection.test.ts`:

```ts
import { parse } from '../Editor/markdown/parser'
import { documentText } from './languageDetection'

it('omits editable heading prefixes from document text', () => {
  expect(documentText(parse('## Heading\n\nParagraph'))).toBe('Heading Paragraph')
})
```

Update workspace assertions that inspect the internal node:

```ts
expect(editorState.doc.firstChild?.textContent).toBe('# Old')
```

Keep save assertions expecting exactly `# Old`, proving serialization does not duplicate the prefix.

- [ ] **Step 2: Run the focused tests to verify they fail**

```powershell
npm test -- src/renderer/src/components/Outline/documentInfo.test.ts src/renderer/src/components/StatusBar/languageDetection.test.ts src/renderer/src/store/workspace.test.ts
```

Expected: outline/language assertions FAIL because current consumers use raw `textContent`/`textBetween`.

- [ ] **Step 3: Route consumers through shared helpers**

In `documentInfo.ts`:

```ts
import { documentBodyText, headingBodyText } from '../Editor/headingSource'

// extractOutline
const text = headingBodyText(node).trim()

// countWords
const text = documentBodyText(doc, ' ')
```

In `languageDetection.ts`:

```ts
import { documentBodyText } from '../Editor/headingSource'

export function documentText(doc: PMNode | undefined): string {
  return documentBodyText(doc, '\n').replace(/\s+/g, ' ').trim()
}
```

- [ ] **Step 4: Run consumer and workspace tests**

```powershell
npm test -- src/renderer/src/components/Outline/documentInfo.test.ts src/renderer/src/components/StatusBar/languageDetection.test.ts src/renderer/src/store/workspace.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit consumer cleanup**

```powershell
git add src/renderer/src/components/Outline/documentInfo.ts src/renderer/src/components/Outline/documentInfo.test.ts src/renderer/src/components/StatusBar/languageDetection.ts src/renderer/src/components/StatusBar/languageDetection.test.ts src/renderer/src/store/workspace.test.ts
git commit -m "fix: hide heading source from document metadata"
```

### Task 6: Full regression and real navigation verification

**Files:**
- Modify only files required by failures discovered in this verification task.

- [ ] **Step 1: Confirm obsolete textarea code is gone**

Run:

```powershell
rg -n "HeadingSourceView|heading-source-input|heading-source-wrapper|heading-source-rendered" src
```

Expected: no matches.

- [ ] **Step 2: Run formatting checks without rewriting unrelated files**

Run Prettier only on changed TypeScript/CSS files, then inspect the diff:

```powershell
npx prettier --write src/renderer/src/components/Editor/headingSource.ts src/renderer/src/components/Editor/headingSource.test.ts src/renderer/src/components/Editor/headingNormalization.ts src/renderer/src/components/Editor/headingNormalization.test.ts src/renderer/src/components/Editor/commands.ts src/renderer/src/components/Editor/commands.test.ts src/renderer/src/components/Editor/inputrules.ts src/renderer/src/components/Editor/plugins.ts src/renderer/src/components/Editor/syntaxReveal.ts src/renderer/src/components/Editor/syntaxReveal.test.ts src/renderer/src/components/Editor/markdown/parser.ts src/renderer/src/components/Editor/markdown/serializer.ts src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Outline/documentInfo.ts src/renderer/src/components/Outline/documentInfo.test.ts src/renderer/src/components/StatusBar/languageDetection.ts src/renderer/src/components/StatusBar/languageDetection.test.ts src/renderer/src/store/workspace.test.ts src/renderer/src/styles/editor.css
git diff --check
```

Expected: no whitespace errors and no unrelated files changed.

- [ ] **Step 3: Run the complete automated verification suite**

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

Expected: every command exits with code 0.

- [ ] **Step 4: Run Electron and manually verify the reported behavior**

Run:

```powershell
npm run dev
```

Use a document containing:

```markdown
Above paragraph

## Single-line heading

Below paragraph

### A long mixed 中英文 heading that wraps across multiple visual lines when the window is narrow

Final paragraph
```

Verify:

1. Click a heading: its prefix appears inside the same `.ProseMirror` contenteditable and no textarea exists.
2. From the paragraph above, one ArrowDown enters the heading and reveals the prefix.
3. From the heading's last visual line, one ArrowDown enters the paragraph below; no direction key is swallowed.
4. ArrowUp behaves symmetrically.
5. Long wrapped headings navigate between their visual lines before leaving the block.
6. Left/right arrows can enter and edit the visible prefix.
7. Changing `## ` to `### ` changes the rendered heading level after leaving it.
8. Breaking the prefix converts the block to a paragraph without losing text; repairing it converts back.
9. Home, End, Shift-selection, drag selection, Chinese IME, undo, redo, save, reopen, and outline text remain correct.

- [ ] **Step 5: Commit any verification-only corrections and record final evidence**

If verification required code corrections, rerun Step 3 and commit only those corrections:

```powershell
git add src/renderer/src/components/Editor src/renderer/src/components/Outline src/renderer/src/components/StatusBar src/renderer/src/store/workspace.test.ts src/renderer/src/styles/editor.css
git commit -m "fix: cover unified heading edge cases"
```

If no corrections were needed, do not create an empty commit. Record the exact passing commands and manual navigation results in the final handoff.
