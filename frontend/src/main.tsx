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
      staleTime: 0,                  // always refetch on mount — guarantees fresh data
      gcTime: 5 * 60 * 1000,          // 5 min cache
      refetchOnWindowFocus: true,     // refetch when user returns to tab
      refetchOnMount: true,
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
