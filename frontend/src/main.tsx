import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // staleTime 60s — данные считаются свежими минуту, поэтому при
      // переходах между страницами нет повторных сетевых запросов
      // (раньше было 0 → каждый mount = новый запрос → задержки).
      // Real-time актуальность обеспечивает WebSocket: useSocket точечно
      // инвалидирует нужные queryKey при изменениях на сервере.
      staleTime: 60 * 1000,
      gcTime: 10 * 60 * 1000,         // 10 мин держим в кеше
      refetchOnWindowFocus: false,    // не дёргать сеть при каждом alt-tab
      refetchOnMount: true,           // но при первом монтировании — берём из кеша если свежо
      refetchOnReconnect: true,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-right" toastOptions={{
          style: { borderRadius: '12px', fontSize: '14px' },
        }} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
