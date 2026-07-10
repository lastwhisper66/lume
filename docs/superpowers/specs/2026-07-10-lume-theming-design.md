# Lume 主题与 CSS 架构 — 设计文档（Spec）

- 日期：2026-07-10
- 状态：待用户 review，随后转 implementation plan
- 相关方针：见仓库根 `CLAUDE.md`
- 前置背景：修复首页排版时发现 electron-vite 脚手架残留样式与应用浅色主题冲突，决定系统性重做 CSS 架构。曾评估引入 Tailwind/shadcn，因编辑器正文由 ProseMirror 命令式生成、工具类难以作用，且本次目标聚焦「一致性 + 明暗主题 + 可自定义」，最终**不引入框架**，改为设计原生 CSS 变量体系。

## 1. 目标

- 系统性重做 Lume 的 CSS，让**外壳（侧边栏 / 标签栏 / 菜单）与编辑器正文（含代码块 / 表格 / 语法揭示）视觉一致**。
- 支持**明亮 / 黑暗两套主题**，默认跟随系统、可手动覆盖并记忆选择。
- 支持 **Typora 式自定义主题**：用户放置完整 CSS 文件即可整体换肤，且**写坏主题不会破坏布局**。

## 2. 已确认的决策基线

| 维度 | 决定 | 理由 |
| ---- | ---- | ---- |
| 是否引入 UI 框架 | **否**，用原生 CSS 变量体系 | ProseMirror 正文非 JSX，工具类难作用；目标聚焦主题化而非组件库 |
| 切换方式 | **默认跟随系统 + 手动开关可覆盖，记忆选择** | 用户选择 |
| 自定义主题 | **Typora 式：整 CSS 文件替换** | 用户选择，最大自由度 |
| 结构 vs 皮肤 | **结构布局 CSS 始终内置、不可被主题覆盖；主题只管外观** | 保证坏主题不破坏布局 |
| 主题组织 | **方案 C 混合**：`--lume-*` 变量契约 + 内置主题以变量定义为主，自定义可深度写选择器 | 换肤简单 + 深度定制随时可上 + 内置主题精简 |
| 主题存放 | `userData/themes/`，首次启动从内置 `resources/themes/` **缺失才拷贝** | 用户可增删、删掉可重生成 |
| 切换入口 | **原生「主题」菜单**（主进程 Menu） | 最贴近 Typora |
| CodeMirror 明暗 | **纯变量驱动**，单份 CM 主题 + HighlightStyle 全用 `var(--lume-code-*)` | 免去为明暗各写 JS 主题，与契约统一 |

## 3. 总体架构

结构与皮肤彻底分离：

```text
resources/themes/            # 内置主题源文件（electron-builder extraResources 打包）
  light.css                  # 参考浅色主题：定义全部 --lume-* + 少量组件微调
  dark.css                   # 参考深色主题

src/renderer/src/styles/
  structure.css              # 应用外壳布局（sidebar/tabbar/main-pane/empty 等）；
                             # 颜色一律 var(--lume-*)，无写死色值；始终内置加载，主题不覆盖
  editor.css                 # 编辑器正文结构（ProseMirror/表格/代码块容器/图片/marker 定位）；
                             # 同样只有结构、无写死色值；始终内置加载
  fallback.css               # 变量契约兜底默认值（= 浅色），防主题加载前白屏闪烁

<userData>/themes/*.css      # 运行时主题夹：内置主题拷入 + 用户自定义；原生菜单枚举此处
```

数据流：

```text
app.whenReady
  → 确保 userData/themes/ 存在；内置主题缺失才拷入
  → 读 settings.json（缺省用默认）
  → 构建原生「主题」菜单
  → 算有效主题；did-finish-load 后 theme:onApply 推 { name, css } 给渲染
渲染进程
  → 启动 theme:current() 拉当前 { name, css }，注入 <style id="lume-theme">
  → 订阅 theme:onApply，主题变化时替换该 <style> 内容
系统明暗翻转 / 菜单选择 / 重新扫描
  → 主进程重算有效主题 + 重建菜单勾选 + theme:onApply 推新 CSS
```

**关键不变量**：渲染进程永不直接读盘；主进程读主题文件内容后经 IPC 把 CSS 字符串推给渲染注入（符合 contextIsolation，且兼容当前 CSP `style-src 'self' 'unsafe-inline'`——用内联 `<style>` 而非 `file://` link）。

## 4. 变量契约（`--lume-*`）

结构/组件 CSS 全部消费以下变量；主题文件负责定义。分组如下。

### 表面 / 背景

| 变量 | 用途 |
| ---- | ---- |
| `--lume-bg` | 编辑器/正文主背景 |
| `--lume-bg-sidebar` | 侧边栏、标签栏背景 |
| `--lume-bg-elevated` | 菜单/弹层等悬浮面 |
| `--lume-bg-code` | 代码块 / 行内代码背景 |
| `--lume-bg-hover` / `--lume-bg-active` | hover / 按下态填充 |
| `--lume-bg-selection` | 文本选区高亮 |

### 文字

| `--lume-text` | 主文字 |
| `--lume-text-muted` | 次级（目录名、未激活标签、空状态） |
| `--lume-text-faint` | 三级（占位符等） |
| `--lume-link` | 链接色 |
| `--lume-text-code` | 代码默认文字（语法 token 的回退色） |

### 边框 / 强调 / 状态

| `--lume-border` / `--lume-border-strong` | 分隔线 / 强调边框 |
| `--lume-accent` / `--lume-accent-hover` | 激活标签指示条、焦点、主操作色 |
| `--lume-dirty` | 未保存 ● 指示（橙） |

### 编辑器专属

| `--lume-marker` | 语法揭示符号（`#`/`**`/`` ` `` 等）颜色 |
| `--lume-table-header-bg` / `--lume-table-border` | 表头背景 / 表格边框 |
| `--lume-blockquote-border` / `--lume-hr` | 引用竖线 / 分割线 |

### 代码语法高亮（缺省回退 `--lume-text-code`）

`--lume-code-keyword`、`--lume-code-string`、`--lume-code-comment`、`--lume-code-number`、`--lume-code-function`、`--lume-code-type`、`--lume-code-tag`、`--lume-code-attribute`、`--lume-code-operator`

### 排版（主题可改，实现 Typora 式换字体/版心）

| `--lume-font-ui` / `--lume-font-content` / `--lume-font-mono` | UI / 正文 / 等宽字体栈 |
| `--lume-content-width` | 正文版心宽度（默认 780px） |
| `--lume-font-size` | 正文基准字号（默认 16px） |

## 5. 主题状态与持久化

主进程持有状态，存 `userData/settings.json`：

```jsonc
{
  "themeMode": "system",   // "system" 跟随系统 | "manual" 手动固定
  "manualTheme": "light",  // manual 模式下选中的主题名（去 .css 后缀）
  "dayTheme": "light",     // system 模式：系统浅色时用
  "nightTheme": "dark"     // system 模式：系统深色时用
}
```

**有效主题**推导：

- `themeMode === 'manual'` → `manualTheme`
- `themeMode === 'system'` → `nativeTheme.shouldUseDarkColors ? nightTheme : dayTheme`

若引用的主题名在主题夹中不存在（被删/改名），回退到内置 `light`，避免空样式。

## 6. IPC 契约

主进程读文件、算有效主题；渲染进程只注入。

| 通道 | 方向 | 作用 |
| ---- | ---- | ---- |
| `theme:current` | R→M（invoke） | 返回当前有效 `{ name, css }`，启动注入 |
| `theme:onApply` | M→R（事件） | 主题变化时推 `{ name, css }`，渲染替换 `<style id="lume-theme">` |
| `theme:list` | R→M（invoke） | 返回主题名列表（供设置类 UI，可选） |
| `theme:select` | R→M（send） | 手动选主题（也由原生菜单触发）；置 `manual` 模式 |
| `theme:setMode` | R→M（send） | 切 system/manual，或设 day/night 主题 |
| `theme:openFolder` | R→M（send） | `shell.openPath(userData/themes)` |
| `theme:rescan` | R→M（send） | 重新扫描主题夹并重建菜单 |

Preload 经 `contextBridge` 暴露为 `window.api.theme.*`，类型声明写入 `src/preload/index.d.ts`。

## 7. 原生「主题」菜单

主进程 `Menu.buildFromTemplate` 构建应用菜单，含「主题」顶级项：

```text
主题
  ◉ 跟随系统                 (勾选 = system 模式)
  ────────────
  ◉ light                    (radio：选中即切 manual 模式 + 该主题)
  ◉ dark
  ◉ <用户自定义主题…>        (枚举 userData/themes/*.css)
  ────────────
  日间主题  ▸  (light / dark / …)   ← system 模式下生效
  夜间主题  ▸  (light / dark / …)
  ────────────
  打开主题文件夹
  重新扫描主题
```

- 菜单在「启动 / 选择变化 / 系统明暗翻转 / 重新扫描」时**重建**以更新勾选态。
- `autoHideMenuBar: true` 保留：菜单栏默认隐藏、按 Alt 唤出（Windows 惯例）。**可选开关**：改 `false` 让菜单常驻。

## 8. 跟随系统

监听 `nativeTheme.on('updated')`：当 `themeMode === 'system'` 且系统明暗翻转时，重算有效主题 → `theme:onApply` 推新 CSS + 重建菜单勾选。无需重启、无需额外 UI。

## 9. CodeMirror 代码块明暗

`codeblock.ts` 中**只定义一份变量驱动的 CM6 主题**：

- `EditorView.theme(...)`：背景/光标/选区/文字色写成 `var(--lume-bg-code)` / `var(--lume-text-code)` / `var(--lume-bg-selection)` 等。
- `HighlightStyle.define([...])`：各 Lezer highlight tag（keyword/string/comment/number/function/type/operator/propertyName/tagName/attributeName）映射到 `var(--lume-code-*)`，未定义则回退 `var(--lume-text-code)`。
- **不引入** `oneDark` 等预制主题，避免特异性冲突。

因 `var()` 在文档内实时解析，主题一换、`:root` 变量一变，代码块自动跟随明暗，无需 JS 层为明暗各写主题。

## 10. 默认明暗配色

核心值如下；完整值（含全部代码语法 token）写入 `resources/themes/light.css` 与 `dark.css`。

| Token | Light | Dark |
| ----- | ----- | ---- |
| `--lume-bg` | `#ffffff` | `#1e1e1e` |
| `--lume-bg-sidebar` | `#f7f8fa` | `#181818` |
| `--lume-bg-elevated` | `#ffffff` | `#252526` |
| `--lume-bg-code` | `#f6f8fa` | `#262626` |
| `--lume-bg-hover` | `#f0f1f3` | `#2a2d2e` |
| `--lume-bg-active` | `#e6e8eb` | `#37373d` |
| `--lume-bg-selection` | `#d7e6ff` | `#264f78` |
| `--lume-text` | `#2b2b2b` | `#d4d4d4` |
| `--lume-text-muted` | `#8a8a8a` | `#8a8a8a` |
| `--lume-text-faint` | `#b8b8b8` | `#5a5a5a` |
| `--lume-marker` | `#b8b8b8` | `#6a6a6a` |
| `--lume-link` | `#3b6fd6` | `#4aa3ff` |
| `--lume-text-code` | `#24292e` | `#c9d1d9` |
| `--lume-border` | `#ececec` | `#2b2b2b` |
| `--lume-border-strong` | `#d8d8d8` | `#3a3a3a` |
| `--lume-accent` | `#3b82f6` | `#4a9eff` |
| `--lume-accent-hover` | `#2f74e6` | `#6cb0ff` |
| `--lume-dirty` | `#e08a00` | `#e0a030` |
| `--lume-table-header-bg` | `#f7f7f7` | `#262626` |
| `--lume-table-border` | `#dddddd` | `#3a3a3a` |
| `--lume-blockquote-border` | `#dfe2e6` | `#3a3a3a` |
| `--lume-hr` | `#e2e2e2` | `#3a3a3a` |

代码语法高亮：

| Tag | Light（GitHub-Light 系） | Dark（GitHub-Dark 系） |
| --- | --- | --- |
| keyword | `#d73a49` | `#ff7b72` |
| string | `#032f62` | `#a5d6ff` |
| comment | `#6a737d` | `#8b949e` |
| number | `#005cc5` | `#79c0ff` |
| function | `#6f42c1` | `#d2a8ff` |
| type | `#22863a` | `#7ee787` |
| tag | `#22863a` | `#7ee787` |
| attribute | `#6f42c1` | `#d2a8ff` |
| operator | `#24292e` | `#c9d1d9` |

排版默认：`--lume-font-ui` / `--lume-font-content` = `Inter, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif`；`--lume-font-mono` = `ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace`；`--lume-content-width` = `780px`；`--lume-font-size` = `16px`。

## 11. 现有代码改造点

- `src/renderer/src/App.css`：布局/组件规则并入 `styles/structure.css`，所有写死色值改 `var(--lume-*)`。
- `src/renderer/src/components/Editor/Editor.css`：结构规则移入 `styles/editor.css`（仅结构、无颜色）；全部硬编码色（代码块 `#f5f5f5`、表头 `#f7f7f7`、边框 `#ddd`、marker `#b8b8b8` 等）改由变量契约在主题文件中定义。原 `Editor.css` 删除。
- `src/renderer/src/assets/base.css` / `main.css`：清除 electron-vite 残留 token（`--ev-c-*` / `--color-*`）与 demo 样式；`main.css` 只保留 `@import` 与全局基线，`--lume-*` 默认值移入 `fallback.css`。
- `src/renderer/src/components/Editor/nodeviews/codeblock.ts`：加入变量驱动的 CM 主题 + HighlightStyle。
- `src/main/index.ts`：新增主题夹初始化、settings.json 读写、原生菜单、`nativeTheme` 监听、theme IPC handlers。
- `src/preload/index.ts` / `index.d.ts`：暴露并声明 `window.api.theme.*`。
- `electron-builder.yml`：`resources/themes` 加入 `extraResources`（或等价 files 配置）以便打包后主进程可读。

## 12. FOUC 与热重载

- **防白屏**：`fallback.css`（浅色变量兜底）随包加载保证首帧有样式；渲染随后注入有效主题覆盖。深色主题会有极短浅色闪一下——v1 可接受；**可选增强**：主进程在 `did-finish-load` 用 `webContents.insertCSS` 提前注入有效主题。
- **热重载（可选增强）**：`fs.watch(userData/themes)`，用户编辑主题 CSS 时自动重载 + 刷新菜单。v1 先提供「重新扫描」手动项。

## 13. 安全

- 沿用 `html: false`（markdown-it）与外链交系统浏览器打开。
- 自定义主题 CSS 仅作样式注入（`<style>`），不执行脚本；CSP 维持 `style-src 'self' 'unsafe-inline'`，不放开 `script-src`。
- 主题文件读取限定在 `userData/themes/` 与内置 `resources/themes/`，读取时校验路径前缀，拒绝越界。

## 14. 非目标（YAGNI）

- 不做主题在线市场 / 下载。
- 不做可视化主题编辑器（用户直接写/改 CSS 文件）。
- 不做每标签页独立主题（主题是应用级）。
- 不做除明暗外的第三种内置主题（用户可自加）。

## 15. 测试

沿用仓库现状：暂不配置 test runner，靠手动验证——重点验证：明暗切换、跟随系统翻转、手动覆盖记忆、自定义主题加载、坏主题不破坏布局、代码块/表格/语法揭示随主题变色。
