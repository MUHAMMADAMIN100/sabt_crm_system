import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api',
  timeout: 90000, // 90s — AI requests can take 30-60s
  // httpOnly cookie с JWT уйдёт автоматически на каждый запрос (CORS +
  // credentials true на бэке). JavaScript токен прочитать не может.
  withCredentials: true,
})

/** Bearer-токен fallback на случай когда third-party cookies не работают
 *  (Chrome с anti-tracking, incognito, разные домены frontend/backend —
 *  наш случай: фронт на Vercel, бэк на Railway).
 *  Храним в localStorage (по просьбе владельца — постоянный вход на устройстве):
 *    - переживает закрытие/перезапуск браузера → сотрудник не логинится заново;
 *    - refresh-токен бессрочный на практике (10 лет + ротация при каждом
 *      заходе, см. REFRESH_TTL_DAYS на бэке): access молча обновляется
 *      через /auth/refresh, вход слетает только по «Выйти», блокировке
 *      аккаунта или смене пароля;
 *    - «Выйти» полностью чистит хранилище (tokenStore.clear()).
 *  Компромисс: на общем компьютере сессия сохранится, пока не нажать «Выйти».
 *  Читаем и из sessionStorage — плавная миграция со старой схемы: у кого токен
 *  остался в session, он подхватится и перепишется в localStorage. */
const TOKEN_KEY = 'sabt-access-token'
const REFRESH_KEY = 'sabt-refresh-token'
const readEither = (key: string): string | null => {
  try {
    const local = localStorage.getItem(key)
    if (local) return local
    // Миграция со старой схемы: токен остался в sessionStorage (до перехода
    // на localStorage). Переносим его в localStorage при первом чтении, иначе
    // он потеряется при перезапуске браузера и юзеру пришлось бы войти заново.
    const session = sessionStorage.getItem(key)
    if (session) { try { localStorage.setItem(key, session) } catch {} }
    return session
  } catch { return null }
}
export const tokenStore = {
  getAccess(): string | null {
    return readEither(TOKEN_KEY)
  },
  getRefresh(): string | null {
    return readEither(REFRESH_KEY)
  },
  set(accessToken?: string | null, refreshToken?: string | null) {
    try {
      if (accessToken)  localStorage.setItem(TOKEN_KEY, accessToken)
      if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
    } catch {}
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(REFRESH_KEY)
      // Подчищаем и старое место хранения, чтобы не всплыло при миграции.
      sessionStorage.removeItem(TOKEN_KEY)
      sessionStorage.removeItem(REFRESH_KEY)
    } catch {}
  },
}

// Одноразовая миграция при загрузке приложения: у пользователей со старой
// версии токены остались в sessionStorage. Переносим ОБА сразу (не дожидаясь
// цикла refresh — иначе refresh-токен потерялся бы при закрытии браузера, и
// постоянный вход не сработал бы для тех, кто уже был в системе).
try {
  for (const k of [TOKEN_KEY, REFRESH_KEY]) {
    if (!localStorage.getItem(k)) {
      const s = sessionStorage.getItem(k)
      if (s) localStorage.setItem(k, s)
    }
  }
} catch {}

/** Окно «грейс-периода» после успешного login/refresh. Auth store зовёт
 *  markJustAuthed() сразу после установки cookie. В течение этого окна
 *  interceptor НЕ выкидывает на /auth по 401 — это защита от гонки:
 *  dashboard'ы стартуют параллельно кучу запросов, и первый-же с косячным
 *  таймингом куки забирал пользователя обратно на экран входа, хотя
 *  cookie уже выставлена. */
let justAuthedUntil = 0
export const markJustAuthed = (windowMs = 8000) => {
  justAuthedUntil = Date.now() + windowMs
}
/** true пока действует грейс после login — auth.store смотрит на это,
 *  чтобы не сбрасывать `authenticated: false` при случайном 401 в первые
 *  секунды после входа (там могут быть гонки cookie / параллельные запросы). */
export const isJustAuthed = () => Date.now() < justAuthedUntil

api.interceptors.request.use(config => {
  // Bearer-фоллбэк: если в sessionStorage есть access-токен — отправляем
  // его в Authorization header. Cookie с тем же токеном тоже идёт через
  // withCredentials — что сработает, то backend и примет (JwtStrategy
  // умеет извлекать из обоих источников). Это нужно для браузеров,
  // блокирующих third-party cookies (Chrome anti-tracking, incognito).
  // Токен ставим ВСЕГДА, а не «если пусто». Иначе повтор запроса после
  // обновления уходил со старым протухшим заголовком, ловил второй 401 и
  // сотрудника выбрасывало на экран входа — каждые 15 минут работы.
  const access = tokenStore.getAccess()
  if (access && config.headers) {
    ;(config.headers as any).Authorization = `Bearer ${access}`
  }
  if (config.method === 'get' || config.method === 'GET') {
    config.params = { ...(config.params || {}), _t: Date.now() }
  }
  return config
})

/** Чем закончилась попытка продлить сессию.
 *
 *  Различать обязательно: раньше ЛЮБАЯ неудача считалась «сессия мертва», и
 *  сотрудника выбрасывало на экран входа из-за моргнувшего Wi-Fi, спящего
 *  ноутбука или перезапуска сервера. Выходить можно только когда сервер
 *  прямо ответил «токен недействителен». */
type RefreshResult = 'ok' | 'rejected' | 'offline'

/** Ошибка сети/сервера, а не отказ авторизации: связи нет, таймаут,
 *  502/503 при редеплое. Сессию по таким причинам не рвём. */
const isTransient = (e: any): boolean => {
  const status = e?.response?.status
  if (status === undefined) return true              // сеть не ответила вовсе
  if (status >= 500) return true                     // сервер лёг/перезапускается
  if (status === 408 || status === 429) return true  // таймаут, лимит запросов
  return false
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Concurrent-safe refresh: пока один запрос обновляет access-токен,
// остальные ждут его результат, не плодя N параллельных /auth/refresh.
let refreshPromise: Promise<RefreshResult> | null = null
const tryRefresh = (): Promise<RefreshResult> => {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    // Несколько попыток с нарастающей паузой: перезапуск сервера длится
    // секунды, за это время не нужно никого разлогинивать.
    const delays = [0, 1500, 4000, 8000]
    let lastTransient = false
    for (const wait of delays) {
      if (wait) await sleep(wait)
      try {
        // Если refresh-токен лежит у нас (cookies заблокированы) — отдаём его
        // в body. Иначе бэк прочитает из httpOnly cookie.
        const refreshFromStore = tokenStore.getRefresh()
        const { data } = await api.post(
          '/auth/refresh',
          refreshFromStore ? { refreshToken: refreshFromStore } : {},
        )
        if (data?.accessToken || data?.refreshToken) {
          tokenStore.set(data.accessToken, data.refreshToken)
        }
        return 'ok' as const
      } catch (e: any) {
        lastTransient = isTransient(e)
        // Сервер сказал «не годен» — повторять бессмысленно.
        if (!lastTransient) return 'rejected' as const
      }
    }
    return lastTransient ? ('offline' as const) : ('rejected' as const)
  })()
  // Освобождаем слот после завершения — следующий 401 сможет попробовать снова.
  refreshPromise.finally(() => { setTimeout(() => { refreshPromise = null }, 0) })
  return refreshPromise
}

api.interceptors.response.use(
  res => res,
  async err => {
    const raw = err.response?.data?.message
    if (err.response?.data) {
      if (Array.isArray(raw)) {
        err.response.data.message = raw.filter(Boolean).join('\n')
      } else if (raw && typeof raw === 'object') {
        err.response.data.message = Object.values(raw).filter(Boolean).join('\n')
      }
    }

    const status = err.response?.status
    const url: string = err.config?.url || ''
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/refresh') || url.includes('/auth/register')

    // Один раз пробуем refresh при 401 (access-токен живёт всего 15 мин).
    // Не для /auth/* — иначе бесконечный цикл.
    let refreshOutcome: RefreshResult | null = null
    // Две попытки: первый 401 — обычное истечение, второй после успешного
    // обновления означает, что мы промахнулись с токеном (гонка вкладок,
    // ротация) — обновляемся ещё раз, и только потом выходим.
    const attempts: number = err.config?.__retry || 0
    if (status === 401 && !isAuthEndpoint && attempts < 2) {
      refreshOutcome = await tryRefresh()
      if (refreshOutcome === 'ok') {
        err.config.__retry = attempts + 1
        // Заголовок берём свежий: в err.config лежит тот, с которым запрос
        // уже провалился.
        const fresh = tokenStore.getAccess()
        if (fresh && err.config.headers) {
          err.config.headers.Authorization = `Bearer ${fresh}`
        }
        return api.request(err.config)
      }
    }

    // Связи нет или сервер перезапускается — молча отдаём ошибку запросу.
    // Выкидывать человека из системы из-за этого нельзя: сессия жива,
    // просто сейчас недоступен сервер.
    if (refreshOutcome === 'offline') {
      return Promise.reject(err)
    }

    // Досюда доходим либо когда refresh отверг сервер, либо когда продлевать
    // не пробовали (повторный 401 после уже обновлённого токена) — в обоих
    // случаях выходим, иначе получится вечный цикл 401.
    if (
      status === 401 &&
      !window.location.pathname.includes('/auth') &&
      !window.location.pathname.startsWith('/public/')
    ) {
      // Грейс после login: даём фронту 5 сек устаканиться, не делаем агрессивный
      // редирект — пользователь только-только вошёл, выкидывать его обратно
      // на /auth из-за тайминга гонки куки нельзя.
      if (Date.now() < justAuthedUntil) {
        return Promise.reject(err)
      }
      // Причину выхода показываем на экране входа: человек не должен гадать,
      // сломалась система или его действительно вывели.
      const msg: string = err.response?.data?.message || ''
      const low = msg.toLowerCase()
      if (msg.includes('заблокировал') || low.startsWith('blocked')) {
        sessionStorage.setItem('blocked-message', msg.replace(/^BLOCKED:\s*/i, ''))
      } else if (low.includes('reuse') || low.includes('revoked') || low.includes('password')) {
        sessionStorage.setItem('session-message',
          'Пароль был изменён или выполнен вход на другом устройстве. Войдите заново.')
      } else {
        // Обычное истечение — спокойная подсказка, а не красная тревога.
        sessionStorage.setItem('session-message', 'Войдите заново, чтобы продолжить работу.')
      }
      try { localStorage.removeItem('token') } catch {}
      try { localStorage.removeItem('auth-storage') } catch {}
      // Кэш персональных обоев — тоже локальные данные конкретного
      // сотрудника: на общем компьютере следующий не должен увидеть чужую
      // картинку после того, как сессия протухла.
      try { localStorage.removeItem('wallpaper') } catch {}
      tokenStore.clear()
      window.location.href = '/auth'
    }
    return Promise.reject(err)
  },
)

/** Вкладка вернулась из сна (крышку закрыли, ушли на встречу) — access-токен
 *  за это время протух. Обновляем сессию заранее, до того как страница
 *  выстрелит десяток запросов: иначе каждый получит 401 и они хором пойдут
 *  продлевать, а первая же неудача уводила на экран входа.
 *
 *  Проверка «прошло больше 10 минут» бережёт сеть: обычный alt-tab ничего
 *  не запускает. */
if (typeof document !== 'undefined') {
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      hiddenAt = Date.now()
      return
    }
    const slept = Date.now() - hiddenAt
    if (hiddenAt && slept > 10 * 60 * 1000 && tokenStore.getAccess()) {
      tryRefresh().catch(() => { /* не вышло — обычный поток разберётся */ })
    }
    hiddenAt = 0
  })
}

export default api
