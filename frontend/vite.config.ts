import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React — always needed
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Data fetching & state
          'vendor-query': ['@tanstack/react-query', 'zustand', 'axios'],
          // Forms
          'vendor-forms': ['react-hook-form'],
          // Charts — heavy, only on Analytics page
          'vendor-charts': ['recharts'],
          // Real-time
          'vendor-socket': ['socket.io-client'],
          // Utilities
          'vendor-utils': ['date-fns', 'react-hot-toast'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
})
