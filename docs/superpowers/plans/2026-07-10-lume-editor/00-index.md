# Lume 编辑器实现计划 — 索引

> **For agentic workers:** REQUIRED SUB-SKILL: 用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现。各阶段计划中的步骤用 `- [ ]` 复选框跟踪。

**来源 spec：** [../../specs/2026-07-10-lume-editor-design.md](../../specs/2026-07-10-lume-editor-design.md)

**总目标：** 用原生 ProseMirror + prosemirror-markdown 构建一个 Typora 风格、完整支持 GFM 的多文档 Markdown 编辑器（Electron + React + TS）。

**测试策略：** 暂不配置 test runner（已知取舍）。每个任务的验证使用 `npm run typecheck` + `npm run dev` 手动观察，而非自动化测试。

## 阶段与依赖顺序

按下列顺序执行，每个阶段结束时应用可运行、可手动验证：

| 阶段 | 文件 | 产出 | 依赖 |
| ---- | ---- | ---- | ---- |
| P1 | [01-p1-editor-core-commonmark.md](01-p1-editor-core-commonmark.md) | PM 挂载 + CommonMark parse/serialize 内存往返 | 无 |
| P2 | [02-p2-syntax-reveal.md](02-p2-syntax-reveal.md) | 块级 + 行内语法揭示（Typora 核心） | P1 |
| P3 | [03-p3-app-shell.md](03-p3-app-shell.md) | 打开文件夹 / 文件树 / 标签页 / dirty / 文件 IO | P1 |
| P4 | [04-p4-gfm.md](04-p4-gfm.md) | 删除线 → autolink → 任务列表 → 表格 | P1, P2 |
| P5 | [05-p5-nodeviews.md](05-p5-nodeviews.md) | CodeMirror 代码块 / 表格交互 / 图片 | P1, P4 |

## 全局约定

- 包管理：npm。所有命令在仓库根 `d:\work\lume` 下运行。
- 每个任务末尾都 commit，commit message 用 `feat:` / `chore:` / `refactor:` 前缀。
- 每次改完源码后先 `npm run typecheck`，再 `npm run dev` 手动验证。
- 源码模块划分见 spec 第 4 节，严格按该结构落文件。
