import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const MM_PROXY_PORT = process.env.MM_PROXY_PORT || '8787'

const proxy = {
  // Read-only local Node proxy (secrets stay server-side). Start via npm run dev:real
  '/local-api': {
    target: `http://127.0.0.1:${MM_PROXY_PORT}`,
    changeOrigin: true,
    secure: false,
  },
  '/api/kalshi': {
    target: 'https://api.elections.kalshi.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/kalshi/, '/trade-api/v2'),
    secure: true,
  },
  '/api/kalshi-ext': {
    target: 'https://external-api.kalshi.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/kalshi-ext/, '/trade-api/v2'),
    secure: true,
  },
  '/api/noaa': {
    target: 'https://api.weather.gov',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/noaa/, ''),
    secure: true,
    headers: {
      'User-Agent': 'KalshiMoneyMakingMachine/3.0 (edge-finder research; local dev)',
      Accept: 'application/geo+json',
    },
  },
  '/api/espn': {
    target: 'https://site.api.espn.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/espn/, ''),
    secure: true,
  },
  '/api/polymarket': {
    target: 'https://gamma-api.polymarket.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/polymarket/, ''),
    secure: true,
  },
  '/api/binance': {
    target: 'https://api.binance.us',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/binance/, ''),
    secure: true,
  },
  '/api/coinbase': {
    target: 'https://api.exchange.coinbase.com',
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/coinbase/, ''),
    secure: true,
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy },
  preview: { proxy }
})
