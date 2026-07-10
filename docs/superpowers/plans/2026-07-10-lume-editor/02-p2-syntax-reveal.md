# P2 语法揭示（Typora 核心）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。步骤用 `- [ ]` 复选框跟踪。

**Goal:** 实现依赖 selection 的语法揭示插件：光标所在 block 显示块级前缀符号（`#`、`>`、代码围栏），光标所在文本块中与选区相交的行内标记（strong/em/code）两侧显示分隔符；光标离开即消失。

**Architecture:** 一个 ProseMirror `Plugin`，在 `props.decorations` 里根据 `state.selection` 计算 widget decoration。符号是 `contentEditable=false` 的 widget（非真实文本），格式化仍走命令/输入规则。

**Tech Stack:** prosemirror-state、prosemirror-view（Decoration/DecorationSet）。

**验证方式：** 无自动化测试。用 `npm run typecheck` + `npm run dev` 手动观察光标进出各类节点时符号的出现/消失。

**依赖：** P1 完成。

---

## 文件结构（本阶段涉及）

- Create: `src/renderer/src/components/Editor/syntaxReveal.ts` — 语法揭示插件
- Modify: `src/renderer/src/components/Editor/plugins.ts` — 注册插件
- Modify: `src/renderer/src/components/Editor/Editor.css` — `.md-marker` 样式

---

## Task 1: 揭示插件骨架与块级揭示

**Files:** Create: `src/renderer/src/components/Editor/syntaxReveal.ts`

- [ ] **Step 1: 写 syntaxReveal.ts（块级部分）**

```ts
import { Plugin } from 'prosemirror-state'
import type { EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet } from 'prosemirror-view'
import type { EditorView } from 'prosemirror-view'

/** 生成一个灰色、不可编辑的语法符号 widget */
function markerWidget(text: string, extraClass = ''): (view: EditorView) => HTMLElement {
  return () => {
    const el = document.createElement('span')
    el.className = 'md-marker' + (extraClass ? ' ' + extraClass : '')
    el.textContent = text
    el.setAttribute('contenteditable', 'false')
    return el
  }
}

/** 块级揭示：heading 的 #、blockquote 的 >、code_block 的围栏 */
function blockDecorations(state: EditorState, decos: Decoration[]): void {
  const { $from } = state.selection
  const parent = $from.parent
  const start = $from.start()

  if (parent.type.name === 'heading') {
    const prefix = '#'.repeat(parent.attrs.level as number) + ' '
    decos.push(Decoration.widget(start, markerWidget(prefix), { side: -1, key: 'block-h' }))
  } else if (parent.type.name === 'code_block') {
    const params = (parent.attrs.params as string) || ''
    decos.push(
      Decoration.widget(start, markerWidget('```' + params, 'md-marker-block'), {
        side: -1,
        key: 'fence-open'
      })
    )
    decos.push(
      Decoration.widget($from.end(), markerWidget('```', 'md-marker-block'), {
        side: 1,
        key: 'fence-close'
      })
    )
  }

  // blockquote：向上查祖先，命中则在当前段落前显示 '> '
  for (let d = $from.depth; d > 0; d--) {
    if (state.selection.$from.node(d).type.name === 'blockquote') {
      decos.push(Decoration.widget(start, markerWidget('> '), { side: -1, key: 'block-bq' }))
      break
    }
  }
}

export const syntaxRevealPlugin = new Plugin({
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      blockDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
})
```

- [ ] **Step 2: 注册插件（临时，用于验证块级）**

Modify `src/renderer/src/components/Editor/plugins.ts` — 在 import 区加：

```ts
import { syntaxRevealPlugin } from './syntaxReveal'
```

并在 `buildPlugins()` 返回数组末尾加入 `syntaxRevealPlugin`：

```ts
export function buildPlugins(): Plugin[] {
  return [
    buildInputRules(),
    keymap(keymapBindings),
    keymap(baseKeymap),
    dropCursor(),
    gapCursor(),
    history(),
    syntaxRevealPlugin
  ]
}
```

- [ ] **Step 3: 加 .md-marker 样式**

Modify `src/renderer/src/components/Editor/Editor.css`，追加：

```css
.md-marker {
  color: #b8b8b8;
  user-select: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.md-marker-block {
  display: block;
}
```

- [ ] **Step 4: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: 手动验证块级揭示**

Run: `npm run dev`
Expected：

- 光标点入 heading 行 → 行首出现灰色 `##`（对应级别），移出该行 → 消失。
- 光标点入引用块段落 → 行首出现 `>`。
- 光标点入代码块 → 上方出现 ```` ``` ````（含语言）、下方出现 ```` ``` ````。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/Editor/syntaxReveal.ts src/renderer/src/components/Editor/plugins.ts src/renderer/src/components/Editor/Editor.css
git commit -m "feat: 块级语法揭示（heading/blockquote/code fence）"
```

---

## Task 2: 行内揭示（strong / em / code）

**Files:** Modify: `src/renderer/src/components/Editor/syntaxReveal.ts`

- [ ] **Step 1: 加行内揭示函数**

在 `syntaxReveal.ts` 顶部常量区加：

```ts
const INLINE_DELIMS: Record<string, string> = {
  strong: '**',
  em: '*',
  code: '`'
}
```

在 `blockDecorations` 之后加：

```ts
/** 行内揭示：光标所在文本块中，与选区相交的标记范围两侧显示分隔符 */
function inlineDecorations(state: EditorState, decos: Decoration[]): void {
  const { selection } = state
  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock) return

  const blockStart = $from.start()
  const selFrom = selection.from
  const selTo = selection.to

  for (const markName of Object.keys(INLINE_DELIMS)) {
    const delim = INLINE_DELIMS[markName]
    const ranges: Array<[number, number]> = []
    let rangeStart: number | null = null
    let pos = blockStart

    parent.forEach((child) => {
      const hasMark = child.marks.some((m) => m.type.name === markName)
      if (hasMark && rangeStart === null) {
        rangeStart = pos
      } else if (!hasMark && rangeStart !== null) {
        ranges.push([rangeStart, pos])
        rangeStart = null
      }
      pos += child.nodeSize
    })
    if (rangeStart !== null) ranges.push([rangeStart, pos])

    for (const [from, to] of ranges) {
      // 与选区相交（含光标贴边）才揭示
      if (from <= selTo && to >= selFrom) {
        decos.push(
          Decoration.widget(from, markerWidget(delim), { side: -1, key: `${markName}-o-${from}` })
        )
        decos.push(
          Decoration.widget(to, markerWidget(delim), { side: 1, key: `${markName}-c-${to}` })
        )
      }
    }
  }
}
```

- [ ] **Step 2: 在插件里调用**

修改 `decorations`：

```ts
  props: {
    decorations(state) {
      const decos: Decoration[] = []
      blockDecorations(state, decos)
      inlineDecorations(state, decos)
      return DecorationSet.create(state.doc, decos)
    }
  }
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: 手动验证行内揭示**

Run: `npm run dev`
Expected：

- 光标进入一段加粗文字 → 两侧出现 `**`，移出 → 消失。
- 斜体两侧出现 `*`；行内代码两侧出现 `` ` ``。
- 选区跨越多个加粗片段时，各相交片段都揭示。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Editor/syntaxReveal.ts
git commit -m "feat: 行内语法揭示（strong/em/code）"
```

---

## Task 3: link 揭示

**Files:** Modify: `src/renderer/src/components/Editor/syntaxReveal.ts`

link 与其它标记不同：需要在范围前显示 `[`、范围后显示 `](url)`。

- [ ] **Step 1: 加 link 专用揭示**

在 `inlineDecorations` 之后加：

```ts
function linkDecorations(state: EditorState, decos: Decoration[]): void {
  const { selection } = state
  const { $from } = selection
  const parent = $from.parent
  if (!parent.isTextblock) return

  const blockStart = $from.start()
  const selFrom = selection.from
  const selTo = selection.to

  let rangeStart: number | null = null
  let href = ''
  let pos = blockStart

  const flush = (to: number): void => {
    if (rangeStart === null) return
    if (rangeStart <= selTo && to >= selFrom) {
      decos.push(
        Decoration.widget(rangeStart, markerWidget('['), { side: -1, key: `link-o-${rangeStart}` })
      )
      decos.push(
        Decoration.widget(to, markerWidget(`](${href})`), { side: 1, key: `link-c-${to}` })
      )
    }
    rangeStart = null
    href = ''
  }

  parent.forEach((child) => {
    const link = child.marks.find((m) => m.type.name === 'link')
    if (link && rangeStart === null) {
      rangeStart = pos
      href = (link.attrs.href as string) || ''
    } else if (!link && rangeStart !== null) {
      flush(pos)
    }
    pos += child.nodeSize
  })
  flush(pos)
}
```

- [ ] **Step 2: 在插件里调用**

在 `inlineDecorations(state, decos)` 之后加 `linkDecorations(state, decos)`。

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: 手动验证**

在示例文档加一个链接（可先手动构造：选中文字后暂无插入链接 UI，可在 SAMPLE 里写 `[链接](https://example.com)` 让 P1 解析）。
Expected: 光标进入链接文字 → 前显示 `[`，后显示 `](https://example.com)`；移出消失。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Editor/syntaxReveal.ts
git commit -m "feat: link 语法揭示"
```

---

## 阶段完成标准

- `npm run typecheck` 通过。
- 光标进入 heading / blockquote / 代码块 / 加粗 / 斜体 / 行内代码 / 链接时，对应源码符号出现；移出即消失。
- 符号为灰色、不可选中、不进入文档（序列化输出不含这些 widget 文本）。
