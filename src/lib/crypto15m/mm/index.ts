export {
  DEFAULT_PAPER_MM_CONFIG,
  STRICT_PAPER_MM_CONFIG,
  LOOSE_PAPER_MM_CONFIG,
  clampConfig,
  presetsForMode,
  migratePersistedScarcityConfig,
  type PaperMmConfig,
} from './config'
export { PaperMmEngine, paperMmEngine } from './engine'
export { asDollarPrice, formatPnlDual, clampPx, roundPx, isValidQuoteMid } from './prices'
export { fetchLiveOrderbook, fetchLocalHealth, fetchLocalCrypto15m } from './liveBook'
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

export {
  scoreMarketEdge,
  rankMarketsByAbsEdge,
  pickActiveMarkets,
  shouldEvictSanityFlat,
  isMmQuoteUniverseMarket,
  type RankedMarket,
  type PickActiveOptions,
} from './edgeRank'
export {
  PaperMmPortfolio,
  paperMmPortfolio,
  type PortfolioState,
  type PortfolioBookView,
  type PortfolioAggregate,
} from './portfolio'

export {
  PAPER_MM_SESSION_KEY,
  serializePaperMmSession,
  deserializePaperMmSession,
  loadPaperMmSession,
  savePaperMmSession,
  clearPaperMmSession,
  sessionLedgerSigma,
  emptySessionLedger,
  type PersistedPaperMmSession,
  type SessionLedgerPersisted,
} from './persist'

export {
  decideQuoteSides,
  canAcceptInventoryIncreasingFill,
  clampQuotesMakerOnly,
  makerCaptureCents,
  emptyEdgePersistState,
  emptyStuckUnwindState,
  effectiveOpeningMinEdgeCents,
  DEFAULT_DECISION_POLICY,
  type DecisionPolicyInput,
  type DecisionPolicyResult,
  type DecisionPolicyConfig,
  type EdgePersistState,
  type StuckUnwindState,
} from './decisionPolicy'

export {
  TickerFillCapStore,
  HARSH_FILL_POLICY_MARKER,
  emptyFillCapSnapshot,
  harshFillsPerHourFromCounts,
  isHarshFillsPerHourReady,
  isHarshFillRateSoftWarn,
  portfolioFillCap15m,
  HARSH_RATE_MIN_HOURS,
  type FillCapSnapshot,
} from './fillCaps'
export { parkStatusLabel } from './parkStatus'

export {
  SCENARIO_LABEL,
  DEFAULT_SCENARIO_THRESHOLDS,
  evaluateClose,
  closeCaptureCents,
  isRiskFlat,
  isRiskFlatFamily,
  scenarioTag,
  activeScenarioLabel,
  pickActiveScenario,
  type ScenarioId,
  type ScenarioThresholds,
  type CloseDecision,
} from './profitableScenarios'
