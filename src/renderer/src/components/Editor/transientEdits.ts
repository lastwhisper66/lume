import type { Transaction } from 'prosemirror-state'

export type TransientEditFlush = () => void

const transientEditFlushes = new Set<TransientEditFlush>()

export function registerTransientEditFlush(flush: TransientEditFlush): () => void {
  transientEditFlushes.add(flush)
  return () => {
    transientEditFlushes.delete(flush)
  }
}

export function flushTransientEdits(): void {
  for (const flush of [...transientEditFlushes]) flush()
}

// 「透明变换」= 揭示/收起源码这类由光标位置驱动、不代表真实内容改动的事务。
// 它们改动了文档，但不应把文档标记为 dirty、不应进入撤销栈。派发时用 markTransient
// 打标（并配合 addToHistory:false），dispatchTransaction 用 isTransientTransaction
// 判定后跳过 dirty 计算。
const TRANSIENT_META = 'lume-transient-transaction'

export function markTransient(tr: Transaction): Transaction {
  return tr.setMeta(TRANSIENT_META, true)
}

export function isTransientTransaction(tr: Transaction): boolean {
  return tr.getMeta(TRANSIENT_META) === true
}
