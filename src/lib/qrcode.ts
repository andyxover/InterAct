export function buildJoinUrl(sessionReference: string, brand?: string) {
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
  const base = (configuredBase || `${window.location.origin}${window.location.pathname}`).replace(/\/$/, '')
  const query = brand ? `?brand=${encodeURIComponent(brand)}` : ''
  return `${base}/#/join/${sessionReference}${query}`
}
