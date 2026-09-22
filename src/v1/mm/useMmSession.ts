import { useCallback, useSyncExternalStore } from 'react'
import {
  mmSessionStore,
  type MmSessionState,
  type MmSessionStore,
} from './mmSession'

/**
 * React hook over the Paper MM session store (U2.1 framework).
 * Pass an alternate store for tests; default is the V1 singleton.
 */
export function useMmSession(store: MmSessionStore = mmSessionStore): {
  state: MmSessionState
  start: () => void
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
    start: store.start,
    stop: store.stop,
    reset: store.reset,
  }
}
