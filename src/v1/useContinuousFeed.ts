import { useEffect, useState } from 'react'
import {
  getContinuousFeedSnapshot,
  kickContinuousFeedPoll,
  subscribeContinuousFeed,
  type ContinuousFeedSnapshot,
} from '../lib/crypto15m/mm/continuousFeed'

/** Subscribe to the shared continuous proxy feed (~500ms poll). */
export function useContinuousFeed(): ContinuousFeedSnapshot {
  const [snap, setSnap] = useState<ContinuousFeedSnapshot>(() =>
    getContinuousFeedSnapshot(),
  )

  useEffect(() => {
    const unsub = subscribeContinuousFeed(setSnap)
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        kickContinuousFeedPoll()
      }
    }
    const onFocus = () => {
      kickContinuousFeedPoll()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return snap
}
