import { useEffect, useState } from 'react'
import {
  getContinuousFeedSnapshot,
  subscribeContinuousFeed,
  type ContinuousFeedSnapshot,
} from '../lib/crypto15m/mm/continuousFeed'

/** Subscribe to the shared continuous proxy feed (1s poll). */
export function useContinuousFeed(): ContinuousFeedSnapshot {
  const [snap, setSnap] = useState<ContinuousFeedSnapshot>(() =>
    getContinuousFeedSnapshot(),
  )

  useEffect(() => {
    return subscribeContinuousFeed(setSnap)
  }, [])

  return snap
}
