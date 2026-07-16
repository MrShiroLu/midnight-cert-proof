import { Buffer } from 'buffer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/instrument-sans/index.css'
import './index.css'
import App from './App.tsx'

// The Midnight SDK's private-state storage layer (level/abstract-level)
// assumes Node's global Buffer exists; browsers don't have one.
window.Buffer ??= Buffer

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
