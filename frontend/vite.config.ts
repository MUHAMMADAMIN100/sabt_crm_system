import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  optimizeDeps: {
    // heic-to — это один готовый browser-ESM файл на 2.9 МБ (WASM внутри).
    // Прогонять его через esbuild-оптимизатор не нужно: пре-бандл зависает,
    // Vite отдаёт 504 на /node_modules/.vite/deps/heic-to.js, и падает
    // динамический import() в imageCompress → «Не удалось загрузить
    // обновлённую версию страницы». Он и так грузится по требованию
    // (только для HEIC-фото), поэтому исключаем из оптимизации.
    exclude: ['heic-to'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      // Без этой строки сокет уходил в сам Vite и падал: на локальной
      // машине realtime не работал ни у ленты, ни у досок. В проде
      // адрес бэкенда задаёт VITE_API_URL, прокси там не участвует.
      '/socket.io': { target: 'http://127.0.0.1:3000', changeOrigin: true, ws: true },
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
