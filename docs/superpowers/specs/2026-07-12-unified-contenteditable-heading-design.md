# 统一 contenteditable 标题源码设计

## 背景

Lume 的编辑器根节点已经由 ProseMirror 管理为一个统一的浏览器 `contenteditable`。普通正文的光标、选区、输入法、撤销和上下方向键都在这套选区中工作。

当前标题是例外：点击标题后，`HeadingSourceView` 隐藏原标题 DOM，并创建独立的 `<textarea>` 编辑完整 ATX 源码。该输入框形成了编辑器内部的第二套焦点和选区系统，导致：

- 鼠标点击标题才会显示 `#`，键盘移动到标题不会进入源码态。
- `ArrowUp`、`ArrowDown` 先在 textarea 内消耗，不能自然跨越标题与相邻正文。
- 从正文进入标题、再离开标题时可能需要重复按方向键。
- Home、End、Shift 加方向键、拖选及输入法后续都需要额外的 textarea 与 ProseMirror 选区桥接。

本设计参考 Typora 表现出的统一编辑面交互，但不假设 Typora 使用 ProseMirror。Lume 保留现有 ProseMirror 架构，由 ProseMirror 继续管理底层 `contenteditable`、文档模型和历史记录；标题不再切换到独立表单控件。

## 目标

- 标题和正文共享同一个浏览器/ProseMirror 选区。
- 鼠标点击或键盘移动进入标题时，立即显示可编辑的 ATX 前缀。
- 一次 `ArrowUp` 或 `ArrowDown` 可以自然进入或离开标题，不吞键、不要求重复按键。
- `#` 和后面的空格是可选择、可插入、可删除的真实编辑内容。
- 长标题继续使用编辑区宽度自然软换行。
- Markdown 文件读写、撤销重做、大纲、拼写检查和字数统计不把内部标题前缀误当成标题正文。

## 非目标

- 不替换 ProseMirror 或重写整个编辑器内核。
- 不推断或复刻 Typora 的闭源内部代码。
- 不在本次改动中重构代码块、图片等其他 NodeView。
- 不改变 Markdown 文件中的 ATX 标题格式。

## 方案比较

### 方案 A：标题源码进入 ProseMirror 文档并由统一 contenteditable 编辑（采用）

标题节点的 inline 内容以真实的 `#{1,6} ` 前缀开头。插件在标题未激活时隐藏该范围，在选区进入标题后显示该范围。浏览器和 ProseMirror直接管理前缀与正文中的光标。

优点是光标、选区、方向键、软换行和输入法都沿用统一编辑面；缺点是内部文档包含仅用于编辑体验的前缀，所有读取标题纯文本的边界必须显式剥离该前缀。

### 方案 B：自定义 contenteditable NodeView（不采用）

NodeView 自己维护一个可编辑标题 DOM，并把输入同步回 ProseMirror。它虽然使用 `contenteditable` 而不是 textarea，但选区仍由 NodeView 私自管理，跨节点移动仍然需要手动桥接，不能解决根本问题。

### 方案 C：聚焦时临时插入前缀、失焦时删除（不采用）

该方案会让纯文本模型只在激活期间包含前缀，但聚焦和失焦会产生文档 transaction，污染撤销历史、dirty 状态和保存时机，并容易在切换文档及输入法组合输入时产生竞态。

## 文档模型

### 标题内部表示

在编辑器内部，每个标题节点都满足以下结构不变量：

```text
heading(level=3, textContent="### 标题正文")
```

标题正文由公共辅助函数提取：

```text
sourcePrefix = "### "
bodyText     = "标题正文"
```

前缀不增加新的 schema mark 或 inline node。语法揭示插件根据标题开头的合法 ATX 前缀创建 inline decoration，为对应 DOM 范围添加 `heading-source-marker` 样式。这避免把编辑器内部样式状态写入文档，同时保留真实、可编辑的字符位置。

### 结构规范化

新增标题源码规范化插件，在文档 transaction 后维护以下规则：

- 合法的 `# ` 至 `###### ` 前缀使当前块成为对应等级的 heading。
- heading 前缀的井号数量改变时，实时更新 `level` 属性。
- 已存在标题的前缀被改为不合法格式时，把该块转换为 paragraph，并保留用户输入的全部可见文本。
- paragraph 的开头被编辑成合法 ATX 源码时，把该块转换为对应 heading；这也覆盖用户把暂时无效的七个井号重新改回六个井号的情况。
- 通过快捷键或其他命令创建、但尚未包含源码前缀的 heading，由创建命令按目标等级补上前缀。

规范化 transaction 只处理实际受变更影响的文本块，并设置插件 meta，防止自身再次触发无限规范化。

## 显示与选区

### 激活标题

语法揭示插件根据当前 selection 查找所在的 heading：

- 给整个标题添加 `heading-source-active` node decoration。
- 给 ATX 前缀范围添加 `heading-source-marker` inline decoration。
- 编辑器聚焦且标题激活时显示前缀。
- 标题未激活或编辑器失焦时隐藏前缀。

标题正文和前缀始终属于同一个 ProseMirror DOM，不创建 textarea，也不调用额外的 `focus()` 转移焦点。

### 键盘移动

上下方向键不添加标题专用拦截。浏览器先在统一 contenteditable 中计算目标光标位置，ProseMirror 更新 selection，语法揭示插件随后按新 selection 显示或隐藏前缀。

从相邻正文进入尚未激活的标题时，隐藏前缀不参与浏览器的视觉命中；selection 会落在标题正文位置。标题激活后前缀出现，selection 仍保持在同一正文字符位置，不额外消耗一次方向键。

从标题离开时，selection 直接进入相邻块，标题前缀随 decoration 更新隐藏。单行和软换行标题均使用浏览器原生纵向导航。

### 鼠标与选择

- 点击标题正文后，selection 进入标题并显示前缀，正文字符位置保持不变。
- 前缀显示后可以再次点击或用左右键进入其中编辑。
- Shift 加方向键、Home、End 和跨块拖选不进入独立控件，继续由 ProseMirror 原生处理。

## 编辑命令

### Enter

标题使用统一选区后，不再由 textarea 监听 Enter。标题专用命令在 base keymap 之前执行：

- 在标题正文中按 Enter：选区前内容保留为原标题，选区后内容成为紧随其后的 paragraph。
- 选区内容被删除。
- 光标进入新 paragraph 开头。
- 前缀范围不拆入新 paragraph；当选区或光标位于前缀内部时，拆分边界收敛到正文开头。
- 整次拆分是一个 ProseMirror 历史步骤。

### 标题快捷键与输入规则

- `Mod-Shift-1`、`Mod-Shift-2` 等标题命令在转换节点类型时同时写入正确的源码前缀。
- `Mod-Shift-0` 转换为 paragraph 时移除合法标题前缀，只保留标题正文。
- Markdown 标题输入规则与规范化插件协作，确保输入 `# ` 后最终只保留一份可编辑前缀。

### 撤销与重做

所有标题字符编辑和结构转换都发生在 ProseMirror transaction 中，因此直接使用现有 history 插件。删除井号、改变标题级别、转换为段落以及 Enter 拆分均无需浏览器表单历史桥接。

## Markdown 边界

### 解析

Markdown parser 先沿用现有逻辑得到语义 heading，再执行文档后处理，为每个 heading 根据 `level` 补上对应的真实 ATX 前缀。

示例：

```text
文件：     "## 标题"
解析节点： heading(level=2, textContent="## 标题")
```

### 序列化

序列化前创建不修改当前 EditorState 的清洁文档视图：

- 对 heading 剥离合法 ATX 前缀。
- 保留 heading 的 `level` 属性。
- 交给现有 MarkdownSerializer 输出标准 ATX 标题。

示例：

```text
编辑节点： heading(level=2, textContent="## 标题")
清洁节点： heading(level=2, textContent="标题")
文件输出： "## 标题"
```

无效前缀已经由规范化插件转换成 paragraph，因此按普通正文原样序列化，不丢失用户输入。

## 纯文本消费者

统一提供 `headingBodyText(node)` 和 `headingPrefixLength(node)` 等辅助函数，禁止各处自行用固定下标截取。以下消费者读取 heading 时使用正文文本：

- 大纲标题与跳转信息。
- 文档字数和字符数统计。
- 语言检测和拼写检查文本。
- 任何窗口标题、搜索结果或辅助功能标签中展示的标题文字。

普通 paragraph 不自动剥离看起来像井号的文本；只有 heading 节点使用标题正文辅助函数。

## 文件与组件变更边界

- `schema/gfm.ts`：保持现有 heading schema，不新增专用 mark。
- 新增标题源码辅助模块：解析前缀、生成前缀、取得正文、为解析文档补前缀、为序列化创建清洁文档。
- 新增标题规范化插件及标题 Enter/类型切换命令。
- `markdown/parser.ts`：解析完成后为 heading 补内部前缀。
- `markdown/serializer.ts`：序列化清洁文档，避免重复输出前缀。
- `syntaxReveal.ts`：为活动 heading 添加 node/inline decoration。
- `index.tsx`：删除 heading NodeView 注册。
- `nodeviews/headingSource.ts`：删除 textarea 实现；其仍有价值的纯函数迁入标题源码辅助模块。
- `editor.css`：删除 textarea 样式，增加活动标题前缀显示规则。
- 大纲、状态栏和拼写检查相关模块：改用标题正文辅助函数。

## 边界情况

- 空标题在内部表示为 `"# "`，前缀显示时仍可编辑，序列化为合法空 ATX 标题。
- 七个或更多井号加空格不构成 heading，作为 paragraph 原样保留。
- `#NoSpace` 不构成 heading，作为 paragraph 原样保留。
- 标题正文中后续出现的 `#` 不属于前缀，不会被隐藏或剥离。
- 标题中的 inline marks 只作用于正文；前缀不继承 strong、em、code、link 或 strikethrough。
- 组合输入期间不进行破坏 composing selection 的强制 DOM 聚焦；规范化仅通过 ProseMirror transaction 工作。
- 文档装载、保存和切换文件时不再存在未提交的标题输入框草稿。

## 验证方案

### 自动测试

- Markdown 解析为 H1 至 H6 时，内部节点包含唯一且正确的 ATX 前缀。
- 序列化内部标题不会重复井号，解析与序列化往返保持标准 Markdown。
- selection 通过键盘进入 heading 后产生活动标题 decoration 和可见前缀。
- selection 离开 heading 后前缀隐藏。
- 从上方 paragraph 一次 ArrowDown 进入标题，从标题一次 ArrowDown 进入下方 paragraph；ArrowUp 对称。
- 修改前缀井号数量会更新 heading level。
- 删除或破坏前缀会转换为 paragraph，文本不丢失；重新改成合法 ATX 源码会恢复 heading。
- Enter 在正文开头、中间、末尾及存在选区时正确拆分。
- 撤销和重做覆盖前缀编辑、级别变化、段落转换及 Enter 拆分。
- 大纲、字数统计、语言检测和拼写检查忽略标题前缀。

jsdom 无法可靠模拟浏览器的视觉纵向命中时，自动测试验证 selection transaction 与 decoration 状态；真实 ArrowUp/ArrowDown 的单键跨块行为通过浏览器/Electron 手工测试补足。

### 手工验证

- 用鼠标点击 H1 至 H6，确认前缀出现且正文光标不跳位。
- 从标题上方正文连续按 ArrowDown，确认每次按键都有可见移动，不需要重复按键。
- 从标题下方正文连续按 ArrowUp，确认行为对称。
- 在单行、中文英文混合和多行软换行标题中测试上下移动。
- 编辑井号和空格，确认标题级别、段落转换、保存内容和撤销历史正确。
- 测试 Home、End、Shift 加方向键、跨块拖选和中文输入法组合输入。
- 保存并重新打开文件，确认 Markdown 中没有重复或缺失的标题前缀。

## 完成标准

- 标题编辑过程中不存在 `<textarea class="heading-source-input">`。
- 标题和正文共享 `.ProseMirror` 根 contenteditable 的原生 selection。
- 用户报告的三个方向键问题均不再出现。
- 标题源码编辑、Markdown 往返、撤销重做和纯文本消费者测试通过。
- 项目 lint、typecheck、test 和 build 全部通过。
