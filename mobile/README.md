# 📱 Sabt CRM Mobile (Capacitor wrapper)

Тонкая оболочка вокруг web-приложения [`sabt-crm-system-frontend.vercel.app`](https://sabt-crm-system-frontend.vercel.app).
Под капотом — Capacitor 6 + системный WebView. Размер APK ~3-5 MB.

---

## 🚀 Quick start (Android, ~30 минут)

### Что нужно установить заранее
- **Node.js** ≥ 18 (у тебя уже стоит — есть в проекте)
- **Java JDK 17** — [adoptium.net](https://adoptium.net/temurin/releases/?version=17)
- **Android Studio** — [developer.android.com/studio](https://developer.android.com/studio)
  - При первом запуске даст скачать SDK + эмулятор
  - В Settings → Android SDK поставь галочки: API 34 (Android 14), Build-Tools 34
- Подключённый Android-телефон в режиме разработчика (или эмулятор)

### Сборка APK

```bash
cd mobile

# 1. Установить зависимости
npm install

# 2. Добавить Android платформу (создаст папку android/)
npm run add:android

# 3. Синхронизировать настройки + плагины
npm run sync

# 4. Открыть проект в Android Studio
npm run open:android
```

Дальше в Android Studio:
1. Дождаться индексации Gradle (~3-5 мин в первый раз)
2. **Build** → **Build Bundle(s) / APK(s)** → **Build APK(s)**
3. APK появится в `android/app/build/outputs/apk/debug/app-debug.apk`
4. Перенеси этот файл на телефон и установи (придётся разрешить "Установка из неизвестных источников")

### Release APK (для раздачи / Play Store)

```bash
# 1. Создать ключ подписи (один раз)
keytool -genkey -v -keystore sabt-release.keystore -alias sabt -keyalg RSA -keysize 2048 -validity 10000

# 2. В android/app/build.gradle прописать signingConfig (Android Studio это делает через GUI: Build → Generate Signed Bundle / APK)

# 3. Собрать
cd android
./gradlew assembleRelease
# результат: android/app/build/outputs/apk/release/app-release.apk
```

Для **Google Play** нужен AAB вместо APK:
```bash
./gradlew bundleRelease
# результат: android/app/build/outputs/bundle/release/app-release.aab
```

---

## 🍎 iOS (macOS only)

Нужен **Mac + Xcode 15+**. На Windows iOS-сборка невозможна.

```bash
cd mobile
npm install
npm run add:ios
npm run sync
npm run open:ios
```

Дальше в Xcode: подписать команду в Signing & Capabilities, выбрать симулятор / устройство → Run.
Для App Store: Product → Archive → Distribute App.

---

## 🎨 Иконка и splash screen

1. Сделать одну квадратную иконку **1024×1024 px** (например в [appicon.co](https://appicon.co))
2. Сгенерировать ресурсы:
   ```bash
   npm install -g @capacitor/assets
   # положи source-иконку в mobile/resources/icon.png и splash в mobile/resources/splash.png
   npx @capacitor/assets generate
   ```
3. `npm run sync` чтобы перенести в нативные проекты

---

## ⚙️ Конфигурация

Все настройки в **`capacitor.config.json`**:

| Поле | Что значит |
|---|---|
| `appId` | Уникальный package name: `com.sabtsystem.crm` |
| `appName` | Имя в системе телефона: "Sabt CRM" |
| `server.url` | URL веб-приложения, которое грузится в WebView. Сейчас → Vercel. |
| `server.cleartext` | `false` — только HTTPS (правильно для prod) |
| `plugins.SplashScreen` | Настройки заставки при запуске |
| `plugins.StatusBar` | Цвет верхней панели телефона |

### Переключение между prod / staging / локалкой

Чтобы тестировать на локальном бэке (например `http://192.168.1.5:5173`):
```json
"server": {
  "url": "http://192.168.1.5:5173",
  "cleartext": true
}
```
И в `android/app/src/main/AndroidManifest.xml` добавить `android:usesCleartextTraffic="true"` в `<application>`.

---

## 🔔 Push-уведомления (опционально)

WebView сам по себе push не получает. Чтобы пользователи получали push даже когда приложение закрыто:

1. Создать проект в Firebase, получить `google-services.json`
2. Установить плагин:
   ```bash
   npm install @capacitor/push-notifications
   npx cap sync
   ```
3. На бэке настроить FCM SDK для отправки.

**Альтернатива:** сейчас у тебя уже работают **Telegram-уведомления** через бота — это покрывает 90% потребности и работает без push-инфраструктуры.

---

## 🐛 Типичные проблемы

| Проблема | Решение |
|---|---|
| APK не устанавливается ("App not installed") | Версия в `android/app/build.gradle` (`versionCode`) должна быть выше предыдущей |
| Белый экран после сплэша | Открой Chrome DevTools → `chrome://inspect/#devices` → подключи телефон, увидишь логи WebView |
| CORS-ошибки | На бэке `https://sabtcrmsystem-production.up.railway.app` разреши origin `https://localhost`, `capacitor://localhost`, `https://sabt-crm-system-frontend.vercel.app` |
| Назад-кнопка закрывает приложение | По умолчанию ОК. Если нужно "назад в истории WebView" — установить `@capacitor/app` и обработать `App.addListener('backButton')` |
| Потеря логина после перезапуска | localStorage сохраняется. Если нет — проверь что используется не `sessionStorage` |

---

## 📦 Что в этой папке

```
mobile/
├── README.md              ← ты сейчас здесь
├── package.json           ← npm-зависимости + скрипты
├── capacitor.config.json  ← главный конфиг (URL, splash, статус-бар)
├── www/index.html         ← fallback-страница (если Vercel недоступен)
├── .gitignore             ← исключает node_modules + сгенерированные android/ ios/
├── android/               ← создаётся командой `npm run add:android` (не в git)
└── ios/                   ← создаётся командой `npm run add:ios` (не в git)
```

`android/` и `ios/` папки **не коммитятся** — они генерируются из конфига и npm-зависимостей одной командой `npx cap add android`. На любой машине настройка занимает 5 минут после клона репозитория.
