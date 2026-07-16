import { createRequire } from 'node:module'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const require = createRequire(import.meta.url)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // level/abstract-level (used by the private-state provider) import
      // Node's "events" module for EventEmitter. Vite externalizes Node
      // builtins in browser builds instead of erroring, which leaves
      // EventEmitter undefined and breaks any "class X extends EventEmitter".
      // Point it at the userland browser polyfill instead.
      events: require.resolve('events'),
    },
  },
  // Vite's dev-time dependency pre-bundling re-orders module init in a way
  // that breaks these wasm-bindgen packages ("Cannot access '__wbindgen_start'
  // before initialization"). Serve them as native ESM instead.
  optimizeDeps: {
    exclude: [
      '@midnight-ntwrk/ledger-v8',
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/zkir-v2',
      '@midnight-ntwrk/compact-js',
      '@midnight-ntwrk/compact-runtime',
    ],
    // compact-runtime imports this CJS package directly; excluding
    // compact-runtime above means Vite no longer supplies the CJS->ESM
    // interop for it unless we force it back into pre-bundling.
    include: ['object-inspect'],
  },
})
