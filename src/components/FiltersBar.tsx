import type { FilterState } from '../types/kalshi'

interface Props {
  filters: FilterState
  categories: string[]
  onChange: (next: FilterState) => void
  count: number
  total: number
}

export function FiltersBar({ filters, categories, onChange, count, total }: Props) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Edge filters
          </h2>
          <p className="text-xs text-slate-500">
            Showing {count} of {total} markets · junk hidden by default
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            className="rounded border-slate-600"
            checked={filters.hideIlliquid}
            onChange={(e) => onChange({ ...filters, hideIlliquid: e.target.checked })}
          />
          Hide illiquid / failed gate
        </label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <div className="xl:col-span-2">
          <label className="label" htmlFor="search">
            Search
          </label>
          <input
            id="search"
            className="input"
            placeholder="Title or ticker…"
            value={filters.search}
            onChange={(e) => onChange({ ...filters, search: e.target.value })}
          />
        </div>
        <div>
          <label className="label" htmlFor="category">
            Category
          </label>
          <select
            id="category"
            className="input"
            value={filters.category}
            onChange={(e) => onChange({ ...filters, category: e.target.value })}
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="minLiq">
            Min liquidity
          </label>
          <input
            id="minLiq"
            type="number"
            min={0}
            max={100}
            step={5}
            className="input"
            value={filters.minLiquidity}
            onChange={(e) =>
              onChange({
                ...filters,
                minLiquidity: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
              })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor="minEdge">
            Min |edge| %
          </label>
          <input
            id="minEdge"
            type="number"
            min={0}
            max={50}
            step={0.5}
            className="input"
            value={filters.minEdgePct}
            onChange={(e) =>
              onChange({
                ...filters,
                minEdgePct: Math.min(50, Math.max(0, Number(e.target.value) || 0)),
              })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor="midBand">
            Mid band (¢)
          </label>
          <div className="flex gap-1">
            <input
              id="midBand"
              type="number"
              min={0}
              max={100}
              className="input"
              value={filters.midMin}
              title="Min mid ¢"
              onChange={(e) =>
                onChange({
                  ...filters,
                  midMin: Math.min(filters.midMax, Math.max(0, Number(e.target.value) || 0)),
                })
              }
            />
            <input
              type="number"
              min={0}
              max={100}
              className="input"
              value={filters.midMax}
              title="Max mid ¢"
              onChange={(e) =>
                onChange({
                  ...filters,
                  midMax: Math.max(filters.midMin, Math.min(100, Number(e.target.value) || 100)),
                })
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
