# P1 编辑器内核 + CommonMark 往返 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 在渲染进程挂载一个 ProseMirror `EditorView`，用 prosemirror-markdown 跑通 Markdown 字符串 → PM 文档 → Markdown 字符串的往返。

**Architecture:** 单一 `EditorView` 承载单一富文本 PM 文档；解析/序列化经 `markdown/parser.ts`、`markdown/serializer.ts` 隔离；插件在 `plugins.ts` 组合。本阶段只做 CommonMark（GFM 留到 P4）。

**Tech Stack:** ProseMirror（state/view/model/markdown/commands/keymap/history/inputrules/schema-list）、React 19、TypeScript。

**验证方式：** 无自动化测试。每步用 `npm run typecheck` + `npm run dev` 手动观察 + DevTools 控制台日志验证往返。

---

## 文件结构（本阶段涉及）

- Create: `src/renderer/src/components/Editor/schema/base.ts` — 导出基础 schema
- Create: `src/renderer/src/components/Editor/markdown/parser.ts` — MarkdownParser（CommonMark）
- Create: `src/renderer/src/components/Editor/markdown/serializer.ts` — MarkdownSerializer（CommonMark）
- Create: `src/renderer/src/components/Editor/inputrules.ts` — 基础输入规则
- Create: `src/renderer/src/components/Editor/commands.ts` — 加粗/斜体等命令 + 快捷键表
- Create: `src/renderer/src/components/Editor/plugins.ts` — 组合插件
- Create: `src/renderer/src/components/Editor/index.tsx` — EditorView 的 React 包装
- Create: `src/renderer/src/components/Editor/Editor.css` — 基础样式
- Modify: `src/renderer/src/App.tsx` — 用示例文档挂载 Editor
- Modify: `src/renderer/src/main.tsx` — 引入 Editor 样式（如需）

---

## Task 1: 安装 ProseMirror 依赖

**Files:** Modify: `package.json`（由 npm 自动写入）

- [ ] **Step 1: 安装内核依赖**

Run:

```bash
npm install prosemirror-state prosemirror-view prosemirror-model prosemirror-markdown prosemirror-commands prosemirror-keymap prosemirror-history prosemirror-inputrules prosemirror-schema-list
```

Expected: 安装成功，`package.json` 的 `dependencies` 新增以上 9 个包。

- [ ] **Step 2: 类型检查基线**

Run: `npm run typecheck`
Expected: PASS（无错误）。

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 ProseMirror 内核依赖"
```

---

## Task 2: 基础 schema

prosemirror-markdown 自带的 `schema` 已包含 CommonMark 所需全部节点/标记。本阶段直接复用并再导出，为后续 P4 在 `schema/gfm.ts` 扩展留出接缝。

**Files:** Create: `src/renderer/src/components/Editor/schema/base.ts`

- [ ] **Step 1: 写 schema/base.ts**

```ts
import { schema as markdownSchema } from 'prosemirror-markdown'
import type { Schema } from 'prosemirror-model'

// P1 直接复用 prosemirror-markdown 的 CommonMark schema。
// P4 会在 schema/gfm.ts 基于 markdownSchema.spec 克隆并扩展 GFM 节点/标记。
export const schema: Schema = markdownSchema
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/schema/base.ts
git commit -m "feat: 基础 CommonMark schema"
```

---

## Task 3: Markdown parser（CommonMark）

**Files:** Create: `src/renderer/src/components/Editor/markdown/parser.ts`

- [ ] **Step 1: 写 markdown/parser.ts**

```ts
import { defaultMarkdownParser } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

// P1：CommonMark。P4 会替换为基于 GFM 版 markdown-it 的自建 MarkdownParser。
export function parse(markdown: string): PMNode {
  const doc = defaultMarkdownParser.parse(markdown)
  if (!doc) throw new Error('Markdown 解析失败')
  return doc
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/markdown/parser.ts
git commit -m "feat: CommonMark Markdown parser"
```

---

## Task 4: Markdown serializer（CommonMark）

**Files:** Create: `src/renderer/src/components/Editor/markdown/serializer.ts`

- [ ] **Step 1: 写 markdown/serializer.ts**

```ts
import { defaultMarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

// P1：CommonMark。P4 会替换为含表格/任务列表/删除线的自建 MarkdownSerializer。
export function serialize(doc: PMNode): string {
  return defaultMarkdownSerializer.serialize(doc)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/markdown/serializer.ts
git commit -m "feat: CommonMark Markdown serializer"
```

---

## Task 5: 命令与快捷键

**Files:** Create: `src/renderer/src/components/Editor/commands.ts`

- [ ] **Step 1: 写 commands.ts**

```ts
import { toggleMark, setBlockType, wrapIn, chainCommands, exitCode } from 'prosemirror-commands'
import { undo, redo } from 'prosemirror-history'
import type { Command } from 'prosemirror-state'
import { schema } from './schema/base'

export const toggleStrong: Command = toggleMark(schema.marks.strong)
export const toggleEm: Command = toggleMark(schema.marks.em)
export const toggleCode: Command = toggleMark(schema.marks.code)

const hardBreak = schema.nodes.hard_break
const insertHardBreak: Command = chainCommands(exitCode, (state, dispatch) => {
  if (dispatch) {
    dispatch(state.tr.replaceSelectionWith(hardBreak.create()).scrollIntoView())
  }
  return true
})

export const keymapBindings: Record<string, Command> = {
  'Mod-b': toggleStrong,
  'Mod-i': toggleEm,
  'Mod-`': toggleCode,
  'Mod-z': undo,
  'Mod-y': redo,
  'Shift-Mod-z': redo,
  'Shift-Enter': insertHardBreak,
  'Mod-Shift-1': setBlockType(schema.nodes.heading, { level: 1 }),
  'Mod-Shift-2': setBlockType(schema.nodes.heading, { level: 2 }),
  'Mod-Shift-0': setBlockType(schema.nodes.paragraph),
  'Mod-Shift-.': wrapIn(schema.nodes.blockquote)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/commands.ts
git commit -m "feat: 编辑命令与快捷键绑定"
```

---

## Task 6: 输入规则

**Files:** Create: `src/renderer/src/components/Editor/inputrules.ts`

- [ ] **Step 1: 写 inputrules.ts**

```ts
import {
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  smartQuotes,
  emDash,
  ellipsis,
  InputRule
} from 'prosemirror-inputrules'
import type { Plugin } from 'prosemirror-state'
import { schema } from './schema/base'

// "> " → blockquote
const blockQuoteRule = wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote)

// "1. " → 有序列表
const orderedListRule = wrappingInputRule(
  /^(\d+)\.\s$/,
  schema.nodes.ordered_list,
  (match) => ({ order: +match[1] }),
  (match, node) => node.childCount + node.attrs.order === +match[1]
)

// "- " / "* " / "+ " → 无序列表
const bulletListRule = wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list)

// "``` " → 代码块
const codeBlockRule = textblockTypeInputRule(/^```$/, schema.nodes.code_block)

// "# " ~ "###### " → heading
const headingRule = textblockTypeInputRule(
  new RegExp('^(#{1,6})\\s$'),
  schema.nodes.heading,
  (match) => ({ level: match[1].length })
)

// "**x**" → strong
function markInputRule(regexp: RegExp, markType): InputRule {
  return new InputRule(regexp, (state, match, start, end) => {
    const [full, content] = match
    const tr = state.tr
    if (content) {
      const textStart = start + full.indexOf(content)
      const textEnd = textStart + content.length
      if (textEnd < end) tr.delete(textEnd, end)
      if (textStart > start) tr.delete(start, textStart)
      const to = start + content.length
      tr.addMark(start, to, markType.create())
      tr.removeStoredMark(markType)
    }
    return tr
  })
}

const strongRule = markInputRule(/\*\*([^*]+)\*\*$/, schema.marks.strong)
const emRule = markInputRule(/(?:^|[^*])\*([^*]+)\*$/, schema.marks.em)
const codeRule = markInputRule(/`([^`]+)`$/, schema.marks.code)

export function buildInputRules(): Plugin {
  return inputRules({
    rules: [
      ...smartQuotes,
      ellipsis,
      emDash,
      blockQuoteRule,
      orderedListRule,
      bulletListRule,
      codeBlockRule,
      headingRule,
      strongRule,
      emRule,
      codeRule
    ]
  })
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。若 `markType` 参数报隐式 any，改为 `markType: import('prosemirror-model').MarkType`。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/inputrules.ts
git commit -m "feat: Markdown 输入规则"
```

---

## Task 7: 组合插件

**Files:** Create: `src/renderer/src/components/Editor/plugins.ts`

- [ ] **Step 1: 写 plugins.ts**

```ts
import { history } from 'prosemirror-history'
import { keymap } from 'prosemirror-keymap'
import { baseKeymap } from 'prosemirror-commands'
import { dropCursor } from 'prosemirror-dropcursor'
import { gapCursor } from 'prosemirror-gapcursor'
import type { Plugin } from 'prosemirror-state'
import { keymapBindings } from './commands'
import { buildInputRules } from './inputrules'

export function buildPlugins(): Plugin[] {
  return [
    buildInputRules(),
    keymap(keymapBindings),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history()
  ]
}
```

- [ ] **Step 2: 安装 dropcursor / gapcursor**

Run: `npm install prosemirror-dropcursor prosemirror-gapcursor`
Expected: 安装成功。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Editor/plugins.ts package.json package-lock.json
git commit -m "feat: 组合 ProseMirror 插件"
```

---

## Task 8: Editor React 包装组件

**Files:**

- Create: `src/renderer/src/components/Editor/index.tsx`
- Create: `src/renderer/src/components/Editor/Editor.css`

- [ ] **Step 1: 写 Editor.css**

```css
.lume-editor {
  height: 100%;
  overflow-y: auto;
  padding: 24px 40px;
  box-sizing: border-box;
}

.lume-editor .ProseMirror {
  outline: none;
  max-width: 780px;
  margin: 0 auto;
  line-height: 1.7;
  font-size: 16px;
}

.lume-editor .ProseMirror > * + * {
  margin-top: 0.75em;
}

.lume-editor .ProseMirror pre {
  background: #f5f5f5;
  padding: 12px 16px;
  border-radius: 6px;
  overflow-x: auto;
}
```

- [ ] **Step 2: 写 index.tsx**

```tsx
import { useEffect, useRef } from 'react'
import { EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from './schema/base'
import { buildPlugins } from './plugins'
import { parse } from './markdown/parser'
import { serialize } from './markdown/serializer'
import './Editor.css'

interface EditorProps {
  /** 初始 Markdown 文本 */
  initialMarkdown: string
  /** 文档变化时回调，返回最新序列化后的 Markdown */
  onChange?: (markdown: string) => void
}

export function Editor({ initialMarkdown, onChange }: EditorProps): React.JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    if (!mountRef.current) return

    const doc: PMNode = parse(initialMarkdown)
    const state = EditorState.create({ doc, schema, plugins: buildPlugins() })
    const view = new EditorView(mountRef.current, {
      state,
      dispatchTransaction(tr) {
        const newState = view.state.apply(tr)
        view.updateState(newState)
        if (tr.docChanged && onChange) {
          onChange(serialize(newState.doc))
        }
      }
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在挂载时创建一次；initialMarkdown 变化由上层通过 key 重建
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return <div className="lume-editor" ref={mountRef} />
}

export default Editor
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Editor/Editor.css
git commit -m "feat: Editor React 包装组件"
```

---

## Task 9: 用示例文档挂载并验证往返

**Files:** Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: 替换 App.tsx**

```tsx
import { useCallback } from 'react'
import Editor from './components/Editor'

const SAMPLE = `# Lume

这是一个 **加粗**、*斜体*、\`行内代码\` 的段落。

> 引用块

- 列表项 A
- 列表项 B

1. 有序一
2. 有序二

\`\`\`js
console.log('hello')
\`\`\`
`

function App(): React.JSX.Element {
  const handleChange = useCallback((markdown: string) => {
    // 往返验证：编辑后在控制台观察序列化输出
    console.log('[serialize]\\n' + markdown)
  }, [])

  return (
    <div style={{ height: '100vh' }}>
      <Editor initialMarkdown={SAMPLE} onChange={handleChange} />
    </div>
  )
}

export default App
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: 手动验证渲染**

Run: `npm run dev`
Expected:

- 窗口显示 heading「Lume」，加粗/斜体/行内代码正确渲染，引用块、有序/无序列表、代码块可见。
- 光标放入文本、输入内容，DevTools 控制台打印 `[serialize]` 及往返后的 Markdown。

- [ ] **Step 4: 手动验证输入规则**

在编辑器空行依次输入：`##` → 变二级标题；`-` → 变无序列表；`>` → 变引用块；输入 `**粗**` → 自动加粗。
Expected: 各输入规则均生效。

- [ ] **Step 5: 手动验证快捷键**

选中文本按 `Ctrl+B` 加粗、`Ctrl+I` 斜体、`Ctrl+Z` 撤销。
Expected: 均生效。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: 示例文档挂载 Editor 并验证 CommonMark 往返"
```

---

## 阶段完成标准

- `npm run typecheck` 通过。
- `npm run dev` 下可编辑，CommonMark 渲染正确，输入规则与快捷键生效，控制台可见往返序列化输出。
