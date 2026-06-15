import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so built assets load over file:// inside the packaged Electron
  // app (Phase 3). Harmless for the dev server and a static web host.
  base: './',
  plugins: [react()],
})
