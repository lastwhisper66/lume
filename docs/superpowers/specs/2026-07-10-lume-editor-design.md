# Lume 编辑器 — 设计文档（Spec）

- 日期：2026-07-10
- 状态：已确认，待转 implementation plan
- 相关方针：见仓库根 `CLAUDE.md`

## 1. 目标

Lume 是一个 **Typora 风格的所见即所得 Markdown 编辑器**，基于 Electron + React + TypeScript。
核心交互：光标所在 block 显示原始 Markdown 源码，光标离开后渲染为格式化结果；没有独立的「编辑 / 预览」切换。
硬需求：**完整支持 GFM**（表格、任务列表、删除线、autolink），且这些语法均遵循同一「揭示 / 渲染」交互。

## 2. 已确认的决策基线

| 维度 | 决定 | 理由 |
| ---- | ---- | ---- |
| 编辑器路线 | **A：原生 ProseMirror + prosemirror-markdown**，自写语法揭示插件 | 语法揭示是核心且最难，需最大化对 ProseMirror 的控制权；不采用 Milkdown/remark（其抽象会阻碍深度定制，且 Typora 揭示行为任何框架都不白送） |
| 目标范围 | 完整 4 阶段（非原型） | 用户要求一次规划到位 |
| 应用外壳 | **多文档**：打开文件夹为工作区 → 文件树 + 多标签页 + dirty 追踪 + 关闭前提示 | 用户选择完整外壳 |
| 代码块高亮 | **内嵌 CodeMirror 6**（NodeView） | 用户要求真实编辑体验 |
| 渲染进程状态 | **Zustand** | 轻量、少样板；管理工作区 / 标签页 / dirty |
| 测试 | 暂不配置 test runner | 用户选择，靠手动验证（已知取舍） |
| 交付物 | spec + 分阶段 plan（多份文件） | 用户要求按步骤拆分 |

## 3. 总体架构

三进程（electron-vite）：Main（Node.js，文件 IO）/ Preload（contextBridge）/ Renderer（React + ProseMirror）。

- **单一 `EditorView`** 承载「当前激活标签页」；每个打开的文件是一个标签页，各自持有独立的 `EditorState`（doc + selection + history）。切换标签 = 换 state。
- **PM Document 是唯一数据源**；Markdown 字符串仅在读文件 / 存文件两端出现。
- 文件读写只在 Main 进程；Renderer 经 `window.api` 间接访问，保持 contextIsolation。

### 数据流

```text
打开文件夹 ─(workspace:openFolder)→ 目录树 → 侧边栏渲染
点击文件   ─(file:read)→ md 字符串 → parser.parse() → EditorState → 新标签页
编辑       → transaction → 标记该标签 dirty（标题 ●）
保存 Ctrl+S→ serializer.serialize(激活 doc) ─(file:save)→ 写盘 → 清 dirty
关闭标签/窗口且 dirty → 弹「保存 / 放弃 / 取消」
```

## 4. 模块划分（源码）

```text
src/renderer/src/
  store/                      # Zustand：workspace / tabs / dirty 状态
  components/
    Editor/
      index.tsx               # EditorView 包装，随激活标签切换 EditorState
      schema/base.ts          # 克隆 prosemirror-markdown 的 schema
      schema/gfm.ts           # strikethrough / tables / task list 扩展
      markdown/parser.ts      # markdown-it 实例 + MarkdownParser
      markdown/serializer.ts  # MarkdownSerializer（含表格 / 任务列表）
      markdown/tables.ts      # 表格序列化辅助（最麻烦的一段单独隔离）
      syntaxReveal.ts         # 依赖 selection 的语法揭示插件（Typora 核心）
      inputrules.ts           # #、**、代码围栏等输入规则
      commands.ts             # 加粗 / 斜体等命令（keymap 与工具栏复用）
      plugins.ts              # 组合所有 PM 插件
      nodeviews/codeblock.ts  # 内嵌 CodeMirror 6
      nodeviews/table.ts      # prosemirror-tables 交互
      nodeviews/image.ts      # 图片渲染 + 点击编辑 src
      Editor.css
    Workspace/FileTree.tsx    # 侧边文件树
    Tabs/TabBar.tsx           # 标签页栏（含 dirty ●）
  App.tsx                     # 侧边栏 + 标签栏 + Editor 布局
src/main/index.ts             # IPC handlers（workspace / 文件读写）
src/preload/index.ts          # contextBridge 暴露 window.api.*
src/preload/index.d.ts        # window.api 的类型声明
```

## 5. 编辑器内核（Typora 揭示，核心）

原则：**结构存文档、符号不入文档**。heading 是节点、加粗是标记，`#`/`**`/`` ` ``/`~~`/`>` 等符号不写进文档。

- `syntaxReveal` 插件按 `selection` 用 **widget decoration** 揭示：
  - 块级（heading `#`、blockquote `>`、fenced code、hr）：在 block 起始位置注入前缀符号（灰色、`contentEditable=false`）。
  - 行内（strong / em / code / strikethrough / link）：扫描光标所在 textblock，找与选区相交的标记范围，在首尾各插一个分隔符 widget。
- 格式化统一走命令 / 输入规则 / 工具栏，作用于 PM 标记本身。
- ProseMirror 在每次 state 变化（含仅选区变化）时重算 `decorations`，「跟随光标揭示」自动生效。

**已知取舍**：揭示符号是 widget（非真实文本），「删掉一个 `*` 取消加粗」不是编辑路径。与 Milkdown 等 PM 系 Typora 编辑器一致。需处理的边界：光标 / Backspace 在符号处的行为、点进 block 时文字水平位移。

## 6. GFM（三层同步扩展）

- **解析层**：markdown-it `default` 预设（表格 + 删除线）+ `linkify`（autolink）+ `markdown-it-task-lists`；保持 `html: false`（天然满足 tagfilter）。
- **Schema 层**：新增 `strikethrough` 标记（`<s>` / `<del>`）；用 prosemirror-tables 的 `tableNodes` 生成表格四类节点；`list_item` 增加 `checked` 属性（`null` / `true` / `false`）。
- **Parser 层**：追加删除线、表格（table/tr/th/td）、任务列表（自定义 token handler，从 checkbox token 读勾选态写回 `list_item.checked`）。
- **Serializer 层**：删除线（`~~`）、表格序列化（自写遍历行列、补表头分隔行，隔离在 `markdown/tables.ts`）、任务列表前缀（`- [x]` / `- [ ]`）。

**已知难点**：表格序列化与任务列表解析是 GFM 里最麻烦的两处。
**保真取舍**：保存时会归一化 Markdown（`_em_` → `*em*` 等），符合 Typora 风格，不追求逐字节保真。

## 7. NodeViews

- `code_block` → 内嵌 **CodeMirror 6**，需桥接选区 / 撤销 / keymap；用 `@codemirror/language-data` 懒加载语言包。
- `table` → prosemirror-tables（列宽拖拽、单元格选择）。
- `image` → 渲染图片，点击展开 `src` 编辑。

## 8. 文件 I/O 与 IPC 约定

Main 用 `ipcMain.handle` 注册、Preload 用 `contextBridge` 暴露、类型声明写在 `src/preload/index.d.ts`：

- `workspace:openFolder` — 选择文件夹为工作区，返回路径与其中的 Markdown 文件树。
- `file:read(path)` — 读取指定文件内容。
- `file:save(path, content)` — 写回已有路径。
- `file:saveAs(content)` — 弹保存框，返回新路径。

统一 UTF-8。安全：`html: false` 禁用原始 HTML；外部链接交系统浏览器打开，不在应用内导航。

## 9. 实现阶段（= 分阶段 plan 文件）

1. **P1 编辑器内核 + CommonMark 往返** — PM 挂载、parse/serialize 内存往返跑通（先用示例文档）。
2. **P2 语法揭示（Typora 核心）** — 块级 + 行内揭示，尽早验证最难的交互。
3. **P3 应用外壳** — 打开文件夹、文件树、标签页、dirty、文件 IO 全链路。
4. **P4 GFM** — 删除线 → autolink → 任务列表 → 表格，逐个加。
5. **P5 NodeViews** — CodeMirror 代码块、表格交互、图片。

排序理由：最高风险的 P2 揭示紧跟内核，尽早暴露问题；相对独立的外壳 P3 放中间。

## 10. 已知风险

- widget 揭示的编辑边界（光标 / Backspace / 水平位移）。
- CodeMirror ↔ ProseMirror 桥接复杂度（选区、撤销、keymap）。
- 表格序列化需手写。
- 任务列表解析需自定义 token handler。
- 无自动化测试（依用户选择），靠手动验证。
