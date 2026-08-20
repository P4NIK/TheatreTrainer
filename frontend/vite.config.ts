import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The Go backend runs on :8080 by default. Override with VITE_API_TARGET if
// you start it on a different port.
const apiTarget = process.env.VITE_API_TARGET ?? 'http://localhost:8080'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
})
