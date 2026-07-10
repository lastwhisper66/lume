import { schema as markdownSchema } from 'prosemirror-markdown'
import type { Schema } from 'prosemirror-model'

// P1 直接复用 prosemirror-markdown 的 CommonMark schema。
// P4 会在 schema/gfm.ts 基于 markdownSchema.spec 克隆并扩展 GFM 节点/标记。
export const schema: Schema = markdownSchema
