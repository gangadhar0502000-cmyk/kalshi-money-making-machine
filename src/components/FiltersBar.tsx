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
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Filters</h2>
          <p className="text-xs text-slate-500">
            Showing {count} of {total} scored markets
          </p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
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
          <label className="label" htmlFor="minVol">
            Min volume
          </label>
          <input
            id="minVol"
            type="number"
            min={0}
            step={100}
            className="input"
            value={filters.minVolume}
            onChange={(e) =>
              onChange({ ...filters, minVolume: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </div>
        <div>
          <label className="label" htmlFor="minScore">
            Min edge score
          </label>
          <input
            id="minScore"
            type="number"
            min={0}
            max={100}
            step={1}
            className="input"
            value={filters.minScore}
            onChange={(e) =>
              onChange({
                ...filters,
                minScore: Math.min(100, Math.max(0, Number(e.target.value) || 0)),
              })
            }
          />
        </div>
      </div>
    </div>
  )
}
