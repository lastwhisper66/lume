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
