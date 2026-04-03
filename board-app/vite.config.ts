import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3848,
    proxy: {
      '/api': 'http://localhost:3847',
      '/events': {
        target: 'http://localhost:3847',
        ws: true,
      },
    },
  },
})
