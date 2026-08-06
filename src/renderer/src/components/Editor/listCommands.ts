import { chainCommands } from 'prosemirror-commands'
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list'
import type { Command } from 'prosemirror-state'
import { schema } from './schema/gfm'

const listItem = schema.nodes.list_item

export const sinkListItemCommand: Command = sinkListItem(listItem)
export const liftListItemCommand: Command = liftListItem(listItem)

/**
 * 拆分列表项，并让任务项的勾选态「继承但重置」：
 *   null（普通项）    → null    新项仍是普通项
 *   true / false（任务项）→ false 新项仍是任务项，但未勾选
 * 与 Typora 一致：在 `- [x] 已完成` 上回车得到 `- [ ] `，而不是又一个已勾选项。
 *
 * splitListItem 的 itemAttrs 是静态的、且只在行末拆分时才生效，所以这里做两件事：
 * 先按当前项的 checked 算出 itemAttrs 传给 splitListItem（覆盖行末拆分），再在派发前
 * 兜一次把新项重置为未勾选（覆盖行中拆分）。
 *
 * 注意 splitListItem 内部「空列表项 + 嵌套」那条分支自己用 itemType.createAndFill()
 * 构造新项，不走 itemAttrs；那里 checked 取 schema 默认值 null，即空任务项回车后
 * 提升为普通项——这与「空项回车退出任务状态」的直觉一致，无需额外处理。
 */
export const splitListItemKeepChecked: Command = (state, dispatch) => {
  const { $from } = state.selection
  // 与 splitListItem 内部一致地取祖父节点，避免两处对「当前列表项」的判定不一致
  if ($from.depth < 2 || $from.node(-1).type !== listItem) return false
  const checked = $from.node(-1).attrs.checked
  const isTask = checked !== null && checked !== undefined
  const split = splitListItem(listItem, isTask ? { checked: false } : undefined)
  if (!dispatch) return split(state, undefined)

  return split(state, (tr) => {
    // splitListItem 只在「行末拆分」那条路径把 itemAttrs 应用到新项（源码里 types 仅在
    // $to.pos == $from.end() 时才构造）；行中拆分时 types 为 undefined，两半都会继承原
    // attrs，于是 `- [x] ab|cdef` 回车会得到两个 [x]。故统一在此把新项重置为未勾选。
    if (isTask) {
      const $pos = tr.selection.$from
      for (let d = $pos.depth; d > 0; d--) {
        const node = $pos.node(d)
        if (node.type === listItem) {
          if (node.attrs.checked) {
            tr.setNodeMarkup($pos.before(d), undefined, { ...node.attrs, checked: false })
          }
          break
        }
      }
    }
    dispatch(tr)
  })
}

/**
 * 列表里的 Enter：先按列表语义拆分，拆不动再提升。
 *
 * splitListItem 在「顶层列表的空列表项」上会主动返回 false（源码注释：bail out and
 * let next command handle lifting），所以必须显式串 liftListItem 才能实现「空项回车
 * 退出列表」。baseKeymap 的 liftEmptyBlock 只提升一层，嵌套列表下语义不对，不能替代。
 */
export const listEnter: Command = chainCommands(splitListItemKeepChecked, liftListItemCommand)
