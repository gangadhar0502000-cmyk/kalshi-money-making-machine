import { useCallback, useSyncExternalStore } from 'react'
import {
  mmSessionStore,
  type MmSessionState,
  type MmSessionStore,
} from './mmSession'
import { mmRunner, type MmRunner } from './mmRunner'

/**
 * React hook over the Paper MM session store + U2.2 runner.
 * Pass an alternate store/runner for tests; default is the V1 singleton.
 */
export function useMmSession(
  store: MmSessionStore = mmSessionStore,
  runner: MmRunner = mmRunner,
): {
  state: MmSessionState
  start: (ticker?: string | null) => void
  stop: () => void
  reset: () => void
} {
  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  )
  const getSnapshot = useCallback(() => store.getState(), [store])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  return {
    state,
    start: (ticker) => runner.start(ticker),
    stop: () => runner.stop(),
    reset: () => runner.reset(),
  }
}
