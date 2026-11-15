// Ранний preconnect к серверу API (15.11.2026). Раньше это был встроенный
// скрипт в index.html — теперь отдельный файл, чтобы политика CSP обходилась
// без 'unsafe-inline'. Адрес берём из <meta name="sabt-api-url">: его
// подставляет Vite при сборке (%VITE_API_URL%). Не подставлен или пуст
// (локально через прокси) — ничего не делаем. use-credentials — запросы к
// API идут с cookie.
(function () {
  try {
    var meta = document.querySelector('meta[name="sabt-api-url"]')
    var u = meta ? meta.getAttribute('content') || '' : ''
    if (!/^https?:\/\//.test(u)) return
    var l = document.createElement('link')
    l.rel = 'preconnect'
    l.href = u
    l.crossOrigin = 'use-credentials'
    document.head.appendChild(l)
  } catch (e) { /* preconnect — только ускорение, без него всё работает */ }
})()
