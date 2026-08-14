import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

window.addEventListener('error', (event) => {
  console.error('[global-error]', event.message, event.error?.stack || '')
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[unhandled-rejection]', event.reason instanceof Error ? event.reason.stack : event.reason)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
