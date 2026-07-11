# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Goal

**Lume** 是一个 Typora 风格的所见即所得 Markdown 编辑器，基于 Electron + React + TypeScript 构建。
核心交互行为：光标所在的 block 显示原始 Markdown 源码；光标离开后渲染为格式化 HTML。没有独立的"编辑/预览"切换按钮。

Lume 以**完整支持 GFM（GitHub Flavored Markdown）**为目标：除 CommonMark 外，必须实现**表格、任务列表、删除线、autolink**，且这些语法均遵循上述「光标揭示源码 / 离开渲染」的交互行为。

> GFM 规范相对 CommonMark 共定义 **5 个扩展**：表格、任务列表、删除线、autolink，以及 tagfilter（禁用危险原始 HTML）。前 4 项是需要实现的语法特性；tagfilter 是纯输出侧的 HTML 净化规则，因 Lume 已禁用原始 HTML（markdown-it `html: false`）而天然无需处理。

## Commands

```bash
npm run dev          # 开发模式（热重载）
npm run build        # 类型检查 + 构建所有进程
npm run build:win    # 打包 Windows 安装包
npm run lint         # ESLint
npm run typecheck    # TypeScript 检查（node + web 两个配置）
npm run format       # Prettier
```

No test runner is configured yet.

## Electron-vite 三进程架构

| 进程              | 入口                        | tsconfig             |
| ----------------- | --------------------------- | -------------------- |
| Main（Node.js）   | `src/main/index.ts`         | `tsconfig.node.json` |
| Preload           | `src/preload/index.ts`      | `tsconfig.node.json` |
| Renderer（React） | `src/renderer/src/main.tsx` | `tsconfig.web.json`  |

**IPC 约定**：Preload 通过 `contextBridge` 将 `window.electron`（来自 `@electron-toolkit/preload`）和 `window.api`（自定义）暴露给 Renderer。文件读写等 Node.js 能力必须在 `src/main/index.ts` 用 `ipcMain.handle` 注册，在 `src/preload/index.ts` 里用 `contextBridge.exposeInMainWorld` 暴露，类型声明写在 `src/preload/index.d.ts`。

## 技术选型

| 层                   | 选型                     | 说明                                                                    |
| -------------------- | ------------------------ | ----------------------------------------------------------------------- |
| 编辑器框架           | **ProseMirror**          | 提供 Schema / Transaction / NodeView 等精确的文档模型                   |
| Markdown 解析/序列化 | **prosemirror-markdown** | 官方桥接库，内置 `defaultMarkdownParser` 和 `defaultMarkdownSerializer` |
| UI 框架              | React 19                 | 编辑器以 React 组件包装，UI 部分（工具栏、侧边栏等）用 React            |

> ⚠️ `prosemirror-markdown` 底层用 **markdown-it**（不是 remark/unified）解析 Markdown。扩展语法（如 GFM）时，需要在 markdown-it 实例、Parser、Serializer 三处同步扩展，详见下方「GFM 支持」。

### 依赖

已确认走**原生 ProseMirror + prosemirror-markdown** 路线（不采用 Milkdown/remark）。当前仓库仍是 electron-vite 初始脚手架，相关依赖尚未安装，按用途分组：

- **ProseMirror 内核**：prosemirror-state、prosemirror-view、prosemirror-model、prosemirror-markdown、prosemirror-commands、prosemirror-keymap、prosemirror-history、prosemirror-inputrules、prosemirror-schema-list
- **GFM 扩展**：prosemirror-tables、markdown-it-task-lists（markdown-it 已是 prosemirror-markdown 的传递依赖；表格 / 删除线内置于其 `default` 预设）
- **代码块高亮**：CodeMirror 6 及语言包（用 `@codemirror/language-data` 懒加载语言）
- **渲染进程状态**：zustand（管理工作区 / 单个 `WorkspaceDocument` / dirty）

## 编辑器架构设计

### 应用形态

单文档编辑器：打开一个文件夹作为工作区 → 侧边文件树 → 单个当前文档。Zustand store 只持有一个 `WorkspaceDocument | null`，结构为 `{ id, filePath, title, editorState, dirty }`；`Navigation/DocumentHeader` 显示当前文件名，不再使用 `Tabs/TabBar`。

打开另一个文件前，store 会先自动保存 dirty 的当前文档；只有保存成功后才读取并替换为新文档。自动保存失败时保留当前文档并中止切换。多个打开请求通过队列串行处理，避免文件读取与自动保存互相覆盖。窗口关闭时若当前文档 dirty，仍需用户确认。

### 数据流

```
.md 文件
   │ (IPC file:read)
   ▼
Markdown 字符串  ──  parser.parse()  ──▶  PM Document（Node 树）
                                              │
                              WorkspaceDocument.editorState
                                              │
                                      EditorView 渲染
                                              │
                               用户编辑 → Transaction → 新 PM Document（标记 dirty）
                                              │
                                     serializer.serialize()
                                              │
                                     Markdown 字符串
                                              │ (IPC file:save)
                                           .md 文件

打开其他文件：dirty 当前文档 ── 自动 `file:save` ──▶ `file:read` 新文件 ──▶ 替换单个 WorkspaceDocument
```

PM Document 是唯一数据源。Markdown 字符串仅在读文件 / 存文件两端出现。

### 目录结构规划

```
src/renderer/src/
  store/workspace.ts          # Zustand：工作区树 + 单个 WorkspaceDocument + dirty / 自动保存
  components/
    Editor/
      index.tsx               # EditorView 包装，文档 id 变化时重建并装载其 EditorState
      schema/base.ts          # 克隆 prosemirror-markdown 的 schema
      schema/gfm.ts           # strikethrough / tables / task list 扩展
      markdown/parser.ts      # markdown-it 实例 + MarkdownParser
      markdown/serializer.ts  # MarkdownSerializer（含表格 / 任务列表）
      markdown/tables.ts      # 表格序列化辅助（单独隔离）
      syntaxReveal.ts         # 依赖 selection 的语法揭示（Typora 核心）
      inputrules.ts           # #、**、代码围栏等输入规则
      commands.ts             # 加粗 / 斜体等命令（keymap 与工具栏复用）
      plugins.ts              # 组合所有 PM 插件
      nodeviews/codeblock.ts  # 内嵌 CodeMirror 6
      nodeviews/image.ts      # 图片渲染 + 点击编辑 src
    Navigation/
      DocumentHeader.tsx      # 当前单文档标题
    Workspace/
      Sidebar.tsx             # 侧边栏内部的“文件 / 大纲”页面切换
      FileTree.tsx            # 侧边文件树
    Outline/                  # 当前文档大纲与滚动定位
    StatusBar/StatusBar.tsx   # 侧边栏显隐控制与状态栏
  App.tsx                     # DocumentHeader + Sidebar + Editor + StatusBar 布局
src/main/index.ts             # IPC handlers（workspace / 文件读写）
src/preload/index.ts          # contextBridge 暴露 window.api.*
src/preload/index.d.ts        # window.api 的类型声明
```

`Sidebar.tsx` / `structure.css` 中的 `sidebar-tabs`、`sidebar-tab` 仅指侧边栏内部“文件 / 大纲”的页面切换，不是文档标签页。编辑器表格相关的 `table` / `tables` 则是 GFM 表格实现，也与多文档标签无关。

### 编辑交互模型（Typora 行为核心）

与 Typora 一致：**单一 `EditorView`、单一富文本 PM 文档，全程 `contentEditable`**。没有 `<textarea>`、没有「编辑/预览」态切换、没有 per-block 模式机。

核心原则：

1. **文档里存结构，不存符号。** heading 是 `heading` 节点、加粗是 `strong` 标记……Markdown 语法符号（`#`、`**`、`` ` ``、`~~`、`>` 等）**不写进文档**。
2. **靠光标位置揭示语法。** 一个依赖 `selection` 的插件，用 **widget decoration** 只在「光标所在 block / 选区覆盖的标记范围」动态注入语法符号；光标一离开，decoration 消失 → 视觉上回到渲染态。
3. **格式化靠命令，不靠改符号。** 加粗/斜体等通过快捷键（Ctrl+B/I）、输入规则（输入 `**x**` 自动转 `strong`）、工具栏触发，作用于 PM 标记本身。

> ProseMirror 会在每次 state 变化（含仅选区变化）时重新调用 `decorations` prop，所以「跟随光标揭示」是自动的，无需手动监听。

**块级揭示**（heading `#`、blockquote `>`、fenced code（三个反引号）、hr）：
判断光标所在 block 类型，在 block 起始位置用 `Decoration.widget(..., { side: -1 })` 注入前缀符号（灰色、`contentEditable=false`）。

**行内揭示**（`strong` `em` `code` `strikethrough` `link`）：
扫描光标所在 textblock，找出与选区相交的标记范围，在其首尾各插入一个 widget decoration 显示分隔符。

**复杂 block 用 NodeView**（而非用于揭示行为）：

- `code_block` → 内嵌 CodeMirror 6 做语法高亮
- `table` → `prosemirror-tables`（列宽拖拽、单元格选择）
- `image` → 渲染图片，点击时展开 `src` 编辑

> 已知取舍：语法符号是 widget（非真实文本），所以「删掉一个 `*` 取消加粗」不是编辑路径；格式化统一走命令/输入规则/工具栏。这与 Milkdown 等 PM 系 Typora 编辑器一致；若需 100% 复刻「可直接编辑分隔符」，成本很高，可后续增强。

### ProseMirror 插件规划

在 `plugins.ts` 中组合以下插件：

- `history()` — 撤销/重做（Ctrl+Z / Ctrl+Shift+Z）
- `keymap(baseKeymap)` — 基础键绑定
- `keymap({ ... })` — 自定义快捷键（加粗、斜体等）
- `inputRules(...)` — 输入触发规则，例如 `#` 自动变 heading、`**` 触发 bold
- `syntaxRevealPlugin` — 依赖 selection 的语法揭示（Typora 行为核心）

### Schema 说明

直接使用 `prosemirror-markdown` 导出的 `schema`，它已包含：
`doc`, `paragraph`, `blockquote`, `horizontal_rule`, `heading`, `code_block`,
`ordered_list`, `bullet_list`, `list_item`, `text`, `image`, `hard_break`,
`em`, `strong`, `code`, `link`

Lume 以完整支持 GFM 为目标，**必须在此 schema 基础上扩展出表格、任务列表、删除线、autolink** —— 用 `schema.spec` 克隆并添加对应节点/标记，具体做法见下方「GFM 支持」。

## GFM（GitHub Flavored Markdown）支持

**完整支持 GFM 是 Lume 的硬需求。** GFM 相对 CommonMark 定义 5 个扩展：**表格、任务列表、删除线、autolink** 及 **tagfilter**。前四项是需实现的语法；tagfilter 仅是输出侧 HTML 净化，因已配置 markdown-it `html: false`、原始 HTML 不会渲染，故无需单独实现。

要在 prosemirror-markdown（默认走 markdown-it 的 CommonMark 预设、表格/删除线默认关闭）上实现 GFM，须在**三层同步扩展**：

- **解析层**：改用 markdown-it 的 `default` 预设（开表格 + 删除线）并开启 `linkify`（autolink），叠加 `markdown-it-task-lists`；保持 `html: false`。
- **Schema 层**：在克隆的 schema 上新增 `strikethrough` 标记（映射 `<s>` / `<del>`）；用 prosemirror-tables 的 `tableNodes` 生成表格四类节点；给 `list_item` 增加 `checked` 属性（`null` 普通项 / `true|false` 勾选态）。
- **Parser 层**：在默认 token 映射上追加删除线、表格（table/tr/th/td）、任务列表（从 task-lists 的 checkbox token 读出勾选态写回 `list_item.checked`，需自定义 token handler）。
- **Serializer 层**：追加删除线（`~~`）、表格序列化（自写遍历行列、补表头分隔行，隔离在 `markdown/tables.ts`）、任务列表前缀（`- [x]` / `- [ ]`）。

> **已知难点**：表格序列化与任务列表解析是 GFM 里最麻烦的两处。
>
> **round-trip 保真取舍**：prosemirror-markdown（与 Typora 本身一样）保存时会归一化 Markdown（`_em_` → `*em*`、列表 marker 统一、重排空行）。对「Typora 风格」可接受，不追求逐字节保真。
>
> **路线取舍**：已评估 remark / Milkdown 方案，因语法揭示需最大化 ProseMirror 控制权，决定不采用（详见 spec）。

## 文件 I/O 与 IPC 约定

所有文件读写只在 Main 进程进行；Renderer 经 `window.api` 间接访问，保持 contextIsolation。Main 用 `ipcMain.handle` 注册、Preload 用 `contextBridge` 暴露、类型声明写在 `src/preload/index.d.ts`。约定的能力：

- **workspace:openFolder** — 选择文件夹作为工作区，返回路径与其中的 Markdown 文件树。
- **file:read(path)** — 读取指定文件内容（装载或替换当前文档时用）。
- **file:save(path, content)** — 写回已有路径。
- **file:saveAs(content)** — 弹保存框，返回新路径。

统一 UTF-8。安全上：markdown-it `html: false` 禁用原始 HTML；外部链接交系统浏览器打开，不在应用内导航。

## 测试

当前不配置测试运行器（已知取舍，靠手动验证）。后续若引入，优先补 Markdown ⇄ PM 文档的 round-trip 一致性测试，以及语法揭示插件的 decoration 计算。

## 历史实现阶段

以下名称保留历史计划原貌，不代表当前运行时仍采用其中的“标签页”等设计：

1. **P1 编辑器内核 + CommonMark 往返** — PM 挂载、parse/serialize 内存往返跑通。
2. **P2 语法揭示（Typora 核心）** — 块级 + 行内揭示，尽早验证最难的交互。
3. **P3 应用外壳** — 打开文件夹 / 文件树 / 标签页 / dirty / 文件 IO 全链路。
4. **P4 GFM** — 删除线 → autolink → 任务列表 → 表格，逐个加。
5. **P5 NodeViews** — CodeMirror 代码块 / 表格交互 / 图片。
