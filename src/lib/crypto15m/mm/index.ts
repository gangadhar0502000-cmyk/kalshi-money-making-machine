export {
  DEFAULT_PAPER_MM_CONFIG,
  STRICT_PAPER_MM_CONFIG,
  LOOSE_PAPER_MM_CONFIG,
  clampConfig,
  presetsForMode,
  type PaperMmConfig,
} from './config'
export { PaperMmEngine, paperMmEngine } from './engine'
export { asDollarPrice, formatPnlDual, clampPx, roundPx } from './prices'
export { fetchLiveOrderbook, fetchLocalHealth } from './liveBook'
export { parseOrderbookFp, detectBookFills } from './orderbook'
export type {
  MmCancelEvent,
  MmEngineState,
  MmFill,
  MmGuardAction,
  MmQuote,
  MmSnapshot,
} from './types'

export { isMarketOpen, pickBestOpenMarket, pickRollTarget } from './marketSelect'
export {
  isToxicExtremeMid,
  allowBidAtMid,
  allowAskAtMid,
  DEFAULT_TOXIC_MID_LOW,
  DEFAULT_TOXIC_MID_HIGH,
} from './toxicity'

export {
  normCdf,
  estimateYesFairValue,
  edgeVsMidCents,
  type FairValueInput,
  type FairValueEstimate,
} from './fairValue'
