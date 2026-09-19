import type { PaperPortfolio, PaperTrade, Side } from '../types/kalshi'

const STORAGE_KEY = 'kmmm-paper-portfolio-v1'

export function defaultPortfolio(): PaperPortfolio {
  return {
    startingCash: 1000,
    cash: 1000,
    trades: [],
    kellyFraction: 0.25,
    flatStakePct: 2,
    stakeMode: 'kelly',
    updatedAt: new Date().toISOString(),
  }
}

export function loadPortfolio(): PaperPortfolio {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultPortfolio()
    const parsed = JSON.parse(raw) as PaperPortfolio
    if (!parsed || typeof parsed.cash !== 'number') return defaultPortfolio()
    return { ...defaultPortfolio(), ...parsed }
  } catch {
    return defaultPortfolio()
  }
}

export function savePortfolio(p: PaperPortfolio): void {
  const next = { ...p, updatedAt: new Date().toISOString() }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function resetPortfolio(startingCash: number): PaperPortfolio {
  const p: PaperPortfolio = {
    ...defaultPortfolio(),
    startingCash,
    cash: startingCash,
  }
  savePortfolio(p)
  return p
}

export function openPaperTrade(
  portfolio: PaperPortfolio,
  input: {
    ticker: string
    title: string
    side: Side
    entryPrice: number
    stakeDollars: number
    note?: string
  },
): PaperPortfolio {
  const stake = Math.min(input.stakeDollars, portfolio.cash)
  if (stake <= 0 || input.entryPrice <= 0) return portfolio

  const contracts = stake / input.entryPrice
  const trade: PaperTrade = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ticker: input.ticker,
    title: input.title,
    side: input.side,
    contracts,
    entryPrice: input.entryPrice,
    stakeDollars: stake,
    openedAt: new Date().toISOString(),
    status: 'open',
    note: input.note,
  }

  const next: PaperPortfolio = {
    ...portfolio,
    cash: portfolio.cash - stake,
    trades: [trade, ...portfolio.trades],
  }
  savePortfolio(next)
  return next
}

/** Close at a given exit price (YES price for YES side, NO price for NO side). */
export function closePaperTrade(
  portfolio: PaperPortfolio,
  tradeId: string,
  exitPrice: number,
): PaperPortfolio {
  const trades = portfolio.trades.map((t) => {
    if (t.id !== tradeId || t.status !== 'open') return t
    return {
      ...t,
      status: 'closed' as const,
      exitPrice,
      closedAt: new Date().toISOString(),
    }
  })

  const closed = trades.find((t) => t.id === tradeId)
  let cash = portfolio.cash
  if (closed && closed.status === 'closed' && closed.exitPrice !== undefined) {
    cash += closed.contracts * closed.exitPrice
  }

  const next = { ...portfolio, cash, trades }
  savePortfolio(next)
  return next
}

export function portfolioStats(portfolio: PaperPortfolio, marks: Record<string, number>) {
  let openMtm = 0
  let realized = 0

  for (const t of portfolio.trades) {
    if (t.status === 'closed' && t.exitPrice !== undefined) {
      realized += t.contracts * t.exitPrice - t.stakeDollars
    } else if (t.status === 'open') {
      const mark = marks[`${t.ticker}:${t.side}`] ?? t.entryPrice
      openMtm += t.contracts * mark
    }
  }

  const equity = portfolio.cash + openMtm
  const pnl = equity - portfolio.startingCash
  const pnlPct = portfolio.startingCash > 0 ? (pnl / portfolio.startingCash) * 100 : 0

  return { equity, openMtm, realized, pnl, pnlPct }
}
