import { useState } from 'react'
import { Crypto15mLab } from '../components/crypto15m/Crypto15mLab'
import { EdgeFinderApp } from '../components/EdgeFinderApp'

type AppMode = 'crypto15m' | 'edge'

/** Old Lab + Edge Finder — only mounted via ?legacy=1 or #legacy. */
export function LegacyApp() {
  const [mode, setMode] = useState<AppMode>('crypto15m')

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <nav className="mb-6 flex flex-wrap items-center gap-2 border-b border-slate-800 pb-4">
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === 'crypto15m'
              ? 'bg-amber-500 text-slate-950'
              : 'border border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
          }`}
          onClick={() => setMode('crypto15m')}
        >
          Crypto 15m Lab
        </button>
        <button
          type="button"
          className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
            mode === 'edge'
              ? 'bg-emerald-500 text-slate-950'
              : 'border border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-500'
          }`}
          onClick={() => setMode('edge')}
        >
          Edge Finder
        </button>
        <span className="ml-auto text-[11px] text-slate-500">
          Legacy · research only · no API keys · no guaranteed profit
        </span>
      </nav>

      {mode === 'crypto15m' ? <Crypto15mLab /> : <EdgeFinderApp />}

      <footer className="mt-10 border-t border-slate-800/80 pt-6 text-center text-xs text-slate-500">
        Legacy Lab — open without{' '}
        <code className="text-slate-400">?legacy=1</code> for v1 feed UI
      </footer>
    </div>
  )
}
