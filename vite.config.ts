import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Proxy Kalshi public API through Vite so the browser avoids CORS.
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
    },
  },
})
