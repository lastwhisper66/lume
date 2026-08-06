# GFM 语法全覆盖示例

这份文档用来手动验证 Lume 的渲染与「光标揭示源码」行为。把 `samples/` 目录作为工作区打开，
逐个 block 移动光标，观察渲染态与源码态的切换。

## 1. 标题

# 一级标题

## 二级标题

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

Setext 一级标题
===

Setext 二级标题
---

## 2. 段落与换行

这是一个普通段落。段落内部的单个换行
在渲染时会被合并成空格，属于软换行。

这一行末尾有两个空格，构成硬换行  
所以这一句会另起一行。

反斜杠也能产生硬换行\
这一句同样另起一行。

## 3. 行内格式

*单星号斜体* 与 _下划线斜体_ 等价。

**双星号加粗** 与 __双下划线加粗__ 等价。

***加粗加斜体*** 以及 **_混合嵌套_**。

`行内代码` 里的 **符号** 不会被解析。

反引号本身用双反引号包裹：`` 这里有 ` 一个反引号 ``。

~~删除线~~ 是 GFM 扩展，可以和 **加粗** 组合成 ~~**都有**~~。

转义字符：\*不是斜体\*、\_不是斜体\_、\`不是代码\`、\# 不是标题。

## 4. 链接

行内链接：[Lume 仓库](https://github.com)。

带标题的链接：[带 title 的链接](https://example.com 'Example 的标题')。

引用式链接：[引用链接][ref] 和 [折叠引用][]。

尖括号 autolink：<https://example.com/autolink> 与 <someone@example.com>。

裸 URL（GFM autolink literal，靠 linkify 生效）：https://example.com/bare
以及裸邮箱 someone@example.com。

[ref]: https://example.com/reference
[折叠引用]: https://example.com/collapsed

## 5. 图片

行内图片（data URI，离线可显示）：

![蓝色方块](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAYCAIAAAAzn+mLAAAAMElEQVR4nO3OQQ0AMAgEMBxiDM+bC45Hkwpo9bxTKj4QEhISSg+EhISE0gMhIaFlHwMWVXntlLnWAAAAAElFTkSuQmCC)

带 title 的图片：![alt 文本](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4v4OBJESa6lENoxqGlAYAYX+3EGA+leAAAAAASUVORK5CYII= '一个琥珀色方块')

注：`data:image/svg+xml` 会被 markdown-it 的 `validateLink` 拦掉（只放行 gif/png/jpeg/webp），
远程 URL 又会被 index.html 的 CSP `img-src 'self' data:` 拦掉，所以这里用 PNG data URI。

## 6. 引用

> 单层引用。
> 引用内部可以有 **加粗** 和 `代码`。

> 第一层
>
> > 第二层嵌套引用
> >
> > > 第三层

> 引用里也能放列表：
>
> - 第一项
> - 第二项

## 7. 列表

紧凑无序列表：

- 第一项
- 第二项
- 第三项

不同 marker（都会被归一化）：

* 星号 marker
* 星号 marker

+ 加号 marker
+ 加号 marker

有序列表：

1. 第一步
2. 第二步
3. 第三步

从指定序号开始：

5. 第五项
6. 第六项

嵌套列表：

- 一级项
  - 二级项
    - 三级项
  - 另一个二级项
- 一级项，含有序子列表
  1. 子项 A
  2. 子项 B

松散列表（项之间有空行，每项包裹成段落）：

- 第一项的段落。

- 第二项的段落。

多段落列表项：

- 这是第一段。

  这是同一项里的第二段。

## 8. 任务列表（GFM）

- [x] 已完成的任务
- [ ] 未完成的任务
- [X] 大写 X 也算已完成
- 普通列表项（无勾选框），和任务项混在同一个列表里

嵌套任务列表：

- [ ] 父任务
  - [x] 子任务 A
  - [ ] 子任务 B
    - [ ] 孙任务

任务项里带行内格式：

- [x] 带 **加粗**、`代码` 和 [链接](https://example.com) 的任务
- [ ] 带 ~~删除线~~ 的任务

## 9. 代码块

无语言标识的围栏代码块：

```
纯文本，没有高亮。
  缩进会保留。
```

TypeScript：

```typescript
interface WorkspaceDocument {
  id: string
  filePath: string | null
  dirty: boolean
}

export function isDirty(doc: WorkspaceDocument): boolean {
  return doc.dirty
}
```

Python：

```python
def fib(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

JSON：

```json
{
  "name": "lume",
  "gfm": ["tables", "task-lists", "strikethrough", "autolink"]
}
```

Diff：

```diff
- const md = MarkdownIt('commonmark')
+ const md = MarkdownIt('default', { html: false, linkify: true })
```

用四个反引号包裹含三反引号的内容：

````markdown
```js
console.log('嵌套的代码块')
```
````

缩进代码块（四个空格，序列化时会被归一化成围栏）：

    indented code block
    第二行

## 10. 分隔线

三种写法都是 `horizontal_rule`：

---

***

___

## 11. 表格（GFM）

基础表格：

| 语法     | 是否支持 | 说明             |
| -------- | -------- | ---------------- |
| 表格     | 是       | prosemirror-tables |
| 任务列表 | 是       | 解析时写回 checked |
| 删除线   | 是       | `~~` 标记        |

三种对齐 + 默认对齐：

| 默认对齐 | 左对齐 | 居中 | 右对齐 |
| -------- | :----- | :--: | -----: |
| a        | b      |  c   |      d |
| 较长的内容 | 左 | 中 | 右 |

单元格里的行内格式：

| 类型   | 示例                                |
| ------ | ----------------------------------- |
| 加粗   | **bold**                            |
| 斜体   | *italic*                            |
| 代码   | `code`                              |
| 删除线 | ~~struck~~                          |
| 链接   | [example](https://example.com)      |
| 转义   | 竖线 \| 需要转义                    |

单列表格与空单元格：

| 单列  |
| ----- |
| 有值  |
|       |

## 12. 原始 HTML（已禁用）

markdown-it 配置了 `html: false`，所以下面这些不会被当作 HTML 解析，
应当原样显示为文本：

<div align="center">这段不是块级 HTML</div>

行内的 <strong>标签</strong> 也应当是纯文本。

<script>alert('不应执行')</script>

## 13. 已知不支持

以下不属于 GFM 五个扩展，当前不解析，预期原样显示为文本：

脚注引用 [^1] 与定义。

[^1]: 脚注正文。

数学公式 $E = mc^2$ 与围栏块。

## 备注

保存时 prosemirror-markdown 会归一化 Markdown（Setext 标题变 ATX、引用式链接展开为行内、
列表 marker 统一、缩进代码块变围栏）。这是预期取舍。若想恢复本文件原始内容：
`git checkout -- samples/gfm-showcase.md`。

除归一化外，整份文档反复保存**内容不再变化**。曾有两处往返不稳定，已修复，
本文件保留了触发用例（第 7 节三段相邻列表、第 11 节表格里的 `` `~~` ``）：

1. 表格单元格里的行内代码被反复转义（`` `~~` `` → `` `\~\~` `` → `` `\\\~\\\~` ``）。
   原因是 `markdown/tables.ts` 的 `serializeCell` 对带 `code` 标记的文本也调了
   `state.esc()`，而反引号内部不处理反斜杠转义。
2. 相邻的同级无序列表被并成一个、且紧凑列表翻成松散列表。按 CommonMark，同 marker 的
   两段列表中间无论空几行都会合并，只有换 marker 才构成真正的列表边界。

已知的 markdown-it 行为（非缺陷）：表格单元格里未转义的 `|` 即使位于反引号内也会切分单元格，
这符合 GFM；写成 `\|` 才是字面竖线。

