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
      staleTime: 5 * 60 * 1000,   // 5 min — don't refetch unless data is stale
      gcTime: 10 * 60 * 1000,      // 10 min — keep in memory after unmount
      refetchOnWindowFocus: false,  // don't spam API on tab switch
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
