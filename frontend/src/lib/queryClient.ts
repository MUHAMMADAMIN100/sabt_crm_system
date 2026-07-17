import { QueryClient } from '@tanstack/react-query'

/**
 * Единственный QueryClient приложения. Вынесен из main.tsx, чтобы быть
 * доступным вне React-дерева — в частности, auth.store.logout() вызывает
 * queryClient.clear(): без этого кэш предыдущего пользователя (личные
 * заметки, финансы, зарплаты) оставался бы виден следующему, кто войдёт
 * на этом же устройстве без перезагрузки вкладки.
 */
export const queryClient = new QueryClient({
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
