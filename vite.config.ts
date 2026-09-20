import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxy Kalshi + free public data so the browser avoids CORS.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api/kalshi': {
        target: 'https://api.elections.kalshi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kalshi/, '/trade-api/v2'),
        secure: true,
      },
      '/api/kalshi-ext': {
        target: 'https://external-api.kalshi.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/kalshi-ext/, '/trade-api/v2'),
        secure: true,
      },
      // NOAA / NWS — free, no key; requires User-Agent
      '/api/noaa': {
        target: 'https://api.weather.gov',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/noaa/, ''),
        secure: true,
        headers: {
          'User-Agent': 'KalshiMoneyMakingMachine/2.0 (edge-finder research; local dev)',
          Accept: 'application/geo+json',
        },
      },
      // The Odds API (key passed as query param from client when set)
      '/api/odds': {
        target: 'https://api.the-odds-api.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/odds/, ''),
        secure: true,
      },
      // Keyless ESPN scoreboard fallback (spread/ML snippets when present)
      '/api/espn': {
        target: 'https://site.api.espn.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/espn/, ''),
        secure: true,
      },
    },
  },
})
