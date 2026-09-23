/**
 * U2.12: browser hits mm-proxy :8787 directly (separate connection pool from Vite :5173).
 * Tests/Node: empty base → relative `/local-api` (Vitest mocks).
 */
export function getLocalApiBase(): string {
  if (typeof window !== 'undefined') {
    return (import.meta as any).env?.VITE_MM_PROXY_BASE ?? 'http://127.0.0.1:8787'
  }
  return ''
}

export function localApiUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`
  return `${getLocalApiBase()}${p}`
}
