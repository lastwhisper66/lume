# P4 GFM（删除线 / autolink / 任务列表 / 表格）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 在三层（markdown-it 解析 / schema / serializer）同步扩展 GFM：删除线、autolink、任务列表、表格，且删除线遵循语法揭示。

**Architecture:** 用 markdown-it `default` 预设 + `linkify` 自建 `MarkdownParser`；`schema/gfm.ts` 基于 base 克隆并加 strikethrough 标记、prosemirror-tables 节点、`list_item.checked`；serializer 追加删除线、表格（隔离在 `tables.ts`）、任务列表前缀。任务列表解析采用「解析后 post-process 识别 `[ ]`/`[x]` 前缀」的确定性方案，避免 markdown-it-task-lists 的 token 歧义。

**Tech Stack:** markdown-it、prosemirror-tables、prosemirror-markdown（MarkdownParser/Serializer）。

**验证方式：** 无自动化测试。`npm run typecheck` + `npm run dev` 手动验证各 GFM 语法的渲染、揭示、保存往返。

**依赖：** P1、P2 完成。

---

## 文件结构（本阶段涉及）

- Create: `src/renderer/src/components/Editor/schema/gfm.ts` — 扩展 schema
- Modify: `src/renderer/src/components/Editor/markdown/parser.ts` — GFM parser + 任务列表 post-process
- Create: `src/renderer/src/components/Editor/markdown/tables.ts` — 表格序列化
- Modify: `src/renderer/src/components/Editor/markdown/serializer.ts` — GFM serializer
- Modify: `src/renderer/src/components/Editor/commands.ts` / `inputrules.ts` — 删除线命令与输入规则；schema 源切换
- Modify: `src/renderer/src/components/Editor/syntaxReveal.ts` — strikethrough 揭示
- Modify: `src/renderer/src/components/Editor/plugins.ts` — 表格编辑插件
- Modify: `src/renderer/src/store/workspace.ts` — schema 源切换

---

## Task 1: 安装 GFM 依赖

**Files:** Modify: `package.json`

- [ ] **Step 1: 安装**

```bash
npm install markdown-it prosemirror-tables
npm install -D @types/markdown-it
```

Expected: 安装成功（markdown-it 显式装以便 import；prosemirror-tables 提供表格节点与编辑插件）。

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 安装 markdown-it 与 prosemirror-tables"
```

---

## Task 2: 扩展 schema

**Files:** Create: `src/renderer/src/components/Editor/schema/gfm.ts`

- [ ] **Step 1: 写 schema/gfm.ts**

```ts
import { schema as base } from 'prosemirror-markdown'
import { Schema } from 'prosemirror-model'
import { tableNodes } from 'prosemirror-tables'

// GFM 表格：单元格只含 inline 内容（Markdown 表格单元格是单行）
const tNodes = tableNodes({
  tableGroup: 'block',
  cellContent: 'inline*',
  cellAttributes: {}
})

// 给 list_item 增加 checked 属性（null 普通项 / true|false 勾选态）
const baseListItem = base.spec.nodes.get('list_item')
if (!baseListItem) throw new Error('base schema 缺少 list_item')

const nodes = base.spec.nodes
  .update('list_item', {
    ...baseListItem,
    attrs: { ...(baseListItem.attrs ?? {}), checked: { default: null } }
  })
  .append(tNodes)

const marks = base.spec.marks.addToEnd('strikethrough', {
  parseDOM: [{ tag: 's' }, { tag: 'del' }, { style: 'text-decoration=line-through' }],
  toDOM() {
    return ['s', 0]
  }
})

export const schema = new Schema({ nodes, marks })
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS（若 `tableNodes` 返回类型与 OrderedMap.append 不兼容，用 `.append(tNodes as any)` 兜底并注释原因）。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/schema/gfm.ts
git commit -m "feat: GFM 扩展 schema（删除线/表格/任务列表属性）"
```

---

## Task 3: 全局切换 schema 源到 gfm

之前 P1/P3 从 `./schema/base` 引 schema，现统一切到 `./schema/gfm`。

**Files:** Modify: `commands.ts`、`inputrules.ts`、`store/workspace.ts`

- [ ] **Step 1: 改 import**

- `src/renderer/src/components/Editor/commands.ts`：`import { schema } from './schema/base'` → `from './schema/gfm'`
- `src/renderer/src/components/Editor/inputrules.ts`：同上
- `src/renderer/src/store/workspace.ts`：`import { schema } from '../components/Editor/schema/base'` → `from '../components/Editor/schema/gfm'`

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/commands.ts src/renderer/src/components/Editor/inputrules.ts src/renderer/src/store/workspace.ts
git commit -m "refactor: 全局切换到 GFM schema"
```

---

## Task 4: GFM parser + 任务列表 post-process

**Files:** Modify: `src/renderer/src/components/Editor/markdown/parser.ts`

- [ ] **Step 1: 重写 parser.ts**

```ts
import MarkdownIt from 'markdown-it'
import type Token from 'markdown-it/lib/token'
import { MarkdownParser } from 'prosemirror-markdown'
import { Fragment } from 'prosemirror-model'
import type { Node as PMNode } from 'prosemirror-model'
import { schema } from '../schema/gfm'

const md = MarkdownIt('default', { html: false, linkify: true })

function listIsTight(tokens: Token[], i: number): boolean {
  while (++i < tokens.length) {
    if (tokens[i].type !== 'list_item_open') return tokens[i].hidden
  }
  return false
}

const parser = new MarkdownParser(schema, md, {
  blockquote: { block: 'blockquote' },
  paragraph: { block: 'paragraph' },
  list_item: { block: 'list_item' },
  bullet_list: { block: 'bullet_list', getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
  ordered_list: {
    block: 'ordered_list',
    getAttrs: (tok, tokens, i) => ({ order: +tok.attrGet('start')! || 1, tight: listIsTight(tokens, i) })
  },
  heading: { block: 'heading', getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: 'code_block', noCloseToken: true },
  fence: { block: 'code_block', getAttrs: (tok) => ({ params: tok.info || '' }), noCloseToken: true },
  hr: { node: 'horizontal_rule' },
  image: {
    node: 'image',
    getAttrs: (tok) => ({
      src: tok.attrGet('src'),
      title: tok.attrGet('title') || null,
      alt: (tok.children?.[0] && tok.children[0].content) || null
    })
  },
  hardbreak: { node: 'hard_break' },

  // GFM 表格
  table: { block: 'table' },
  thead: { ignore: true },
  tbody: { ignore: true },
  tr: { block: 'table_row' },
  th: { block: 'table_header' },
  td: { block: 'table_cell' },

  // 标记
  em: { mark: 'em' },
  strong: { mark: 'strong' },
  s: { mark: 'strikethrough' },
  link: {
    mark: 'link',
    getAttrs: (tok) => ({ href: tok.attrGet('href'), title: tok.attrGet('title') || null })
  },
  code_inline: { mark: 'code', noCloseToken: true }
})

/** 把 list_item 首段以 [ ] / [x] 开头的项转成 checked 属性并剥离前缀 */
function stripPrefix(para: PMNode, n: number): PMNode {
  const first = para.firstChild
  if (!first || !first.isText) return para
  const newText = (first.text ?? '').slice(n)
  const kids: PMNode[] = []
  para.forEach((c, _off, idx) => {
    if (idx === 0) {
      if (newText) kids.push(c.type.schema.text(newText, c.marks))
    } else {
      kids.push(c)
    }
  })
  return para.copy(Fragment.fromArray(kids))
}

function applyTaskLists(node: PMNode): PMNode {
  const kids: PMNode[] = []
  node.forEach((child) => kids.push(applyTaskLists(child)))
  let out = node.copy(Fragment.fromArray(kids))

  if (out.type.name === 'list_item') {
    const firstPara = out.firstChild
    const firstInline = firstPara?.firstChild
    if (firstPara?.type.name === 'paragraph' && firstInline?.isText) {
      const m = /^\[([ xX])\]\s/.exec(firstInline.text ?? '')
      if (m) {
        const checked = m[1] !== ' '
        const newFirst = stripPrefix(firstPara, m[0].length)
        const paraKids: PMNode[] = []
        out.forEach((c, _off, idx) => paraKids.push(idx === 0 ? newFirst : c))
        out = out.type.create({ ...out.attrs, checked }, Fragment.fromArray(paraKids), out.marks)
      }
    }
  }
  return out
}

export function parse(markdown: string): PMNode {
  const doc = parser.parse(markdown)
  if (!doc) throw new Error('Markdown 解析失败')
  return applyTaskLists(doc)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/markdown/parser.ts
git commit -m "feat: GFM parser（表格/删除线/autolink/任务列表）"
```

---

## Task 5: 表格序列化辅助

**Files:** Create: `src/renderer/src/components/Editor/markdown/tables.ts`

- [ ] **Step 1: 写 tables.ts**

```ts
import type { MarkdownSerializerState } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'

const INLINE: Record<string, [string, string]> = {
  strong: ['**', '**'],
  em: ['*', '*'],
  code: ['`', '`'],
  strikethrough: ['~~', '~~']
}

/** 将单元格 inline 内容渲染为一行 Markdown（转义竖线） */
function serializeCell(cell: PMNode): string {
  let out = ''
  cell.forEach((child) => {
    if (!child.isText) return
    let text = (child.text ?? '').replace(/\|/g, '\\|')
    for (const mark of child.marks) {
      const d = INLINE[mark.type.name]
      if (d) text = d[0] + text + d[1]
    }
    const link = child.marks.find((m) => m.type.name === 'link')
    if (link) text = `[${text}](${link.attrs.href})`
    out += text
  })
  return out
}

export function serializeTable(state: MarkdownSerializerState, node: PMNode): void {
  const rows: string[][] = []
  node.forEach((row) => {
    const cells: string[] = []
    row.forEach((cell) => cells.push(serializeCell(cell)))
    rows.push(cells)
  })
  if (rows.length === 0) return

  const colCount = rows[0].length
  const line = (cells: string[]): string => '| ' + cells.map((c) => c || ' ').join(' | ') + ' |'

  state.write(line(rows[0]) + '\n')
  state.write('| ' + Array(colCount).fill('---').join(' | ') + ' |\n')
  for (let i = 1; i < rows.length; i++) state.write(line(rows[i]) + '\n')
  state.closeBlock(node)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/markdown/tables.ts
git commit -m "feat: GFM 表格序列化"
```

---

## Task 6: GFM serializer

**Files:** Modify: `src/renderer/src/components/Editor/markdown/serializer.ts`

- [ ] **Step 1: 重写 serializer.ts**

```ts
import { defaultMarkdownSerializer, MarkdownSerializer } from 'prosemirror-markdown'
import type { Node as PMNode } from 'prosemirror-model'
import { serializeTable } from './tables'

export const serializer = new MarkdownSerializer(
  {
    ...defaultMarkdownSerializer.nodes,
    list_item(state, node) {
      const checked = node.attrs.checked
      if (checked !== null && checked !== undefined) {
        state.write(checked ? '[x] ' : '[ ] ')
      }
      state.renderContent(node)
    },
    table: serializeTable,
    // 表格由 serializeTable 整体处理，行/单元格不会被单独递归，提供 no-op 兜底
    table_row() {},
    table_cell() {},
    table_header() {}
  },
  {
    ...defaultMarkdownSerializer.marks,
    strikethrough: { open: '~~', close: '~~', mixable: true, expelEnclosingWhitespace: true }
  }
)

export function serialize(doc: PMNode): string {
  return serializer.serialize(doc)
}
```

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/Editor/markdown/serializer.ts
git commit -m "feat: GFM serializer（删除线/表格/任务列表）"
```

---

## Task 7: 删除线的命令 / 输入规则 / 揭示

**Files:** Modify: `commands.ts`、`inputrules.ts`、`syntaxReveal.ts`

- [ ] **Step 1: commands.ts 加删除线命令与快捷键**

在 import 后加：

```ts
export const toggleStrikethrough: Command = toggleMark(schema.marks.strikethrough)
```

在 `keymapBindings` 里加一行：

```ts
  'Mod-Shift-x': toggleStrikethrough,
```

- [ ] **Step 2: inputrules.ts 加删除线输入规则**

加规则并注册：

```ts
const strikeRule = markInputRule(/~~([^~]+)~~$/, schema.marks.strikethrough)
```

把 `strikeRule` 加入 `buildInputRules()` 的 `rules` 数组。

- [ ] **Step 3: syntaxReveal.ts 揭示删除线**

在 `INLINE_DELIMS` 里加：

```ts
  strikethrough: '~~'
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Editor/commands.ts src/renderer/src/components/Editor/inputrules.ts src/renderer/src/components/Editor/syntaxReveal.ts
git commit -m "feat: 删除线命令/输入规则/揭示"
```

---

## Task 8: 表格编辑插件与样式

**Files:** Modify: `plugins.ts`、`Editor.css`

- [ ] **Step 1: plugins.ts 加表格插件**

import 区加：

```ts
import { columnResizing, tableEditing } from 'prosemirror-tables'
```

在 `buildPlugins()` 返回数组里、`history()` 之前加：

```ts
    columnResizing(),
    tableEditing(),
```

- [ ] **Step 2: 引入 prosemirror-tables 样式**

在 `src/renderer/src/components/Editor/index.tsx` 顶部加：

```ts
import 'prosemirror-tables/style/tables.css'
```

并在 `Editor.css` 追加基础表格样式：

```css
.lume-editor table {
  border-collapse: collapse;
  width: 100%;
}
.lume-editor th,
.lume-editor td {
  border: 1px solid #ddd;
  padding: 6px 10px;
}
.lume-editor th {
  background: #f7f7f7;
  font-weight: 600;
}
.lume-editor li[data-checked] {
  list-style: none;
}
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Editor/plugins.ts src/renderer/src/components/Editor/index.tsx src/renderer/src/components/Editor/Editor.css
git commit -m "feat: 表格编辑插件与样式"
```

---

## Task 9: 手动验证 GFM 往返

**Files:** 无（验证）

- [ ] **Step 1: 准备测试文档**

在工作区新建 `gfm-test.md`（用外部编辑器）：

```markdown
删除线：~~废弃~~。

autolink：https://example.com

- [ ] 未完成
- [x] 已完成

| 左 | 右 |
| --- | --- |
| a | **粗** |
```

- [ ] **Step 2: 打开并观察渲染**

Run: `npm run dev` → 打开该文件。
Expected：
- 删除线渲染为划线；光标进入时两侧显示 `~~`。
- `https://example.com` 渲染为链接。
- 任务列表两项分别为未勾/已勾（`- [ ]`/`- [x]` 前缀已转 checked，不显示为纯文本）。
- 表格渲染为网格，`**粗**` 单元格加粗。

- [ ] **Step 3: 往返保存验证**

编辑后 `Ctrl+S`，用外部编辑器查看文件：
Expected：删除线为 `~~...~~`；任务列表为 `- [ ]`/`- [x]`；表格含 `| --- |` 分隔行；结构与语义保持（允许 Markdown 归一化）。

---

## 阶段完成标准

- `npm run typecheck` 通过。
- 删除线、autolink、任务列表、表格四项均能渲染、揭示（删除线）与往返保存。
- 保存输出为合法 GFM。
