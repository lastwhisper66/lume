import { afterEach, describe, expect, it } from 'vitest'
import { flushTransientEdits, registerTransientEditFlush } from './transientEdits'

describe('transient edit flushing', () => {
  const cleanups: Array<() => void> = []

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
  })

  it('registers and unregisters synchronous flush callbacks', () => {
    const calls: string[] = []
    const unregister = registerTransientEditFlush(() => calls.push('flush'))
    cleanups.push(unregister)

    flushTransientEdits()
    unregister()
    flushTransientEdits()

    expect(calls).toEqual(['flush'])
  })

  it('snapshots callbacks before invoking them', () => {
    const calls: string[] = []
    let unregisterSecond = (): void => undefined
    cleanups.push(
      registerTransientEditFlush(() => {
        calls.push('first')
        unregisterSecond()
      })
    )
    unregisterSecond = registerTransientEditFlush(() => calls.push('second'))
    cleanups.push(unregisterSecond)

    flushTransientEdits()

    expect(calls).toEqual(['first', 'second'])
  })
})
