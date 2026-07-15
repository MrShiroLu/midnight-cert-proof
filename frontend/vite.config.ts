import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Vite's dev-time dependency pre-bundling re-orders module init in a way
  // that breaks these wasm-bindgen packages ("Cannot access '__wbindgen_start'
  // before initialization"). Serve them as native ESM instead.
  optimizeDeps: {
    exclude: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/zkir-v2',
    ],
  },
})
