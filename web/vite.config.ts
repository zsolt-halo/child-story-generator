import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'child_process'

let commitHash = (process.env.VITE_COMMIT_HASH || 'unknown').slice(0, 7)
try {
  commitHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch {
  // git not available (e.g., Docker build) — use VITE_COMMIT_HASH from env
}

export default defineConfig({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
