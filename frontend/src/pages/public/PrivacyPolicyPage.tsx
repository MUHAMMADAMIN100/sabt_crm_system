import { useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react'

const UPDATED_AT = '28 октября 2026 г.'

const SECTIONS = [
  { id: 'operator',    title: 'Кто мы и на что распространяется политика' },
  { id: 'data',        title: 'Какие данные мы обрабатываем' },
  { id: 'purposes',    title: 'Цели и правовые основания' },
  { id: 'cookies',     title: 'Cookies и локальное хранилище' },
  { id: 'sharing',     title: 'Кому мы передаём данные' },
  { id: 'retention',   title: 'Сроки хранения' },
  { id: 'security',    title: 'Как мы защищаем данные' },
  { id: 'rights',      title: 'Ваши права' },
  { id: 'deletion',    title: 'Удаление аккаунта и данных' },
  { id: 'children',    title: 'Данные несовершеннолетних' },
  { id: 'changes',     title: 'Изменения политики' },
  { id: 'contacts',    title: 'Контакты' },
]

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24">
      <h2 className="text-base sm:text-lg font-semibold text-surface-900 dark:text-surface-50 tracking-tight">
        {title}
      </h2>
      <div className="mt-3 space-y-3 text-[15px] leading-7 text-surface-600 dark:text-surface-300">
        {children}
      </div>
    </section>
  )
}

function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-2 pl-5 list-disc marker:text-surface-400">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

export default function PrivacyPolicyPage() {
  useEffect(() => {
    const previous = document.title
    document.title = 'Политика конфиденциальности — Sabt CRM'
    return () => { document.title = previous }
  }, [])

  return (
    <div className="min-h-screen auth-page-bg">
      <header className="sticky top-0 z-20 border-b border-surface-200/70 dark:border-surface-800 bg-surface-50/85 dark:bg-surface-950/85 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
          <Link to="/auth" className="flex items-end gap-0 leading-none select-none" aria-label="Sabt CRM — ко входу">
            <span
              className="font-black tracking-tight text-surface-900 dark:text-surface-50"
              style={{ fontSize: 26, fontFamily: "'Arial Black', Arial, sans-serif" }}
            >
              sabt
            </span>
            <svg width="12" height="14" viewBox="0 0 12 14" fill="none" className="ml-0.5 mb-1">
              <path
                d="M1 1L1 11L3.8 8.2L5.6 12.5L7 11.9L5.2 7.6L9 7.6L1 1Z"
                fill="currentColor"
                className="text-surface-900 dark:text-surface-50"
                stroke="currentColor"
                strokeWidth="0.5"
                strokeLinejoin="round"
              />
            </svg>
            <span className="w-2 h-2 rounded-full bg-red-500 mb-3 ml-0.5 shrink-0" />
          </Link>

          <Link
            to="/auth"
            className="inline-flex items-center gap-1.5 rounded-lg border border-surface-200 dark:border-surface-700 px-3 py-1.5 text-xs font-medium text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-800 transition-colors"
          >
            <ArrowLeft size={14} />
            Ко входу
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:pt-12">
        <article className="rounded-3xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-6 sm:p-10 shadow-modal">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-surface-500">
            <ShieldCheck size={14} />
            Документы
          </div>

          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight text-surface-900 dark:text-surface-50">
            Политика конфиденциальности
          </h1>
          <p className="mt-2 text-sm text-surface-500">
            Sabt CRM — веб-версия и мобильное приложение. Редакция от {UPDATED_AT}.
          </p>

          <div className="mt-6 rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-100/70 dark:bg-surface-900/60 p-4 sm:p-5">
            <p className="text-sm leading-6 text-surface-700 dark:text-surface-200">
              <strong className="font-semibold text-surface-900 dark:text-surface-50">Коротко.</strong>{' '}
              Sabt CRM — внутренняя система digital-агентства WeBrand для работы сотрудников:
              задачи, проекты, смены, финансы и клиенты. Мы обрабатываем данные только для этих
              целей, не продаём их и не используем для рекламы. Ниже подробно: что именно мы
              собираем, зачем, кому передаём и как вы можете управлять своими данными.
            </p>
          </div>

          <nav aria-label="Содержание" className="mt-7 rounded-2xl border border-surface-200 dark:border-surface-700 p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-surface-500">Содержание</p>
            <ol className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {SECTIONS.map((section, i) => (
                <li key={section.id} className="flex items-baseline gap-2 text-sm">
                  <span className="w-4 shrink-0 text-right font-mono text-[11px] text-surface-400">{i + 1}.</span>
                  <a
                    href={`#${section.id}`}
                    className="text-surface-600 dark:text-surface-300 hover:text-surface-900 dark:hover:text-surface-50 hover:underline underline-offset-4 transition-colors"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="mt-9 space-y-9">
            <Section id="operator" title="1. Кто мы и на что распространяется политика">
              <p>
                Оператор персональных данных — Индивидуальный предприниматель
                Бобоев Маҳмадсаид Мирзоалиевич (бренд WeBrand), Республика Таджикистан,
                г. Душанбе, р-н Шохмансур, ул. Абуабдуллохи Рудаки, 405.
              </p>
              <p>
                Политика распространяется на веб-версию Sabt CRM по адресу{' '}
                <a href="https://crm.webrand.tj" className="underline underline-offset-4 hover:text-surface-900 dark:hover:text-surface-50">
                  crm.webrand.tj
                </a>{' '}
                и мобильное приложение Sabt CRM. Она не распространяется на сторонние сайты
                и сервисы, ссылки на которые могут встречаться в системе.
              </p>
              <p>
                Система предназначена для сотрудников и подрядчиков агентства. Учётную запись
                создаёт администратор; доступ к разделам зависит от роли.
              </p>
            </Section>

            <Section id="data" title="2. Какие данные мы обрабатываем">
              <p>Мы обрабатываем только те данные, которые нужны для работы системы.</p>
              <p className="font-medium text-surface-800 dark:text-surface-100">2.1. Учётная запись и профиль</p>
              <p>
                ФИО, логин или email, пароль (хранится только в виде необратимого хеша),
                номер телефона, Telegram, Instagram, дата рождения, должность, роль в системе,
                аватар и сведения о себе — если вы их указали.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.2. Рабочие данные</p>
              <p>
                Задачи, комментарии и результаты работы, проекты, отчёты, вложения и файлы,
                отметки о начале и конце смены, учёт рабочего времени, показатели KPI
                и история действий в системе.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.3. Финансовые данные сотрудников</p>
              <p>
                Оклад, премии, выплаты, рассрочки и удержания — в объёме, необходимом для
                расчёта заработной платы и исполнения требований законодательства.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.4. Данные клиентов, внесённые сотрудниками</p>
              <p>
                Название компании, контактное лицо, телефон, email, Instagram, адрес,
                примечания, сведения о проектах и оплатах. Сотрудник должен вносить только
                те данные клиента, которые действительно нужны для работы.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.5. Технические данные</p>
              <p>
                IP-адрес, тип устройства, браузера и операционной системы (User-Agent),
                дата и время входа, действия в системе, идентификаторы сессий и журналы
                безопасности. Мы не запрашиваем геолокацию.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.6. Telegram-бот</p>
              <p>
                Если вы пользуетесь ботом: идентификатор чата, текст сообщений и голосовых,
                которые вы отправляете. Голосовые сообщения распознаются, чтобы поставить
                задачу по вашей команде.
              </p>

              <p className="font-medium text-surface-800 dark:text-surface-100">2.7. ИИ-помощник</p>
              <p>
                Текст ваших запросов, ответы помощника и те рабочие данные, которые вы сами
                включаете в запрос.
              </p>
            </Section>

            <Section id="purposes" title="3. Цели и правовые основания">
              <p>Мы обрабатываем данные, чтобы:</p>
              <List items={[
                'предоставлять доступ к системе и защищать аккаунт: вход, продление сессии, двухфакторная аутентификация, предотвращение несанкционированного доступа;',
                'вести рабочий процесс: задачи, проекты, смены, отчёты, KPI и коммуникацию команды;',
                'рассчитывать заработную плату, премии и другие финансовые обязательства;',
                'вести клиентскую базу, проекты, договоры и оплаты;',
                'отправлять служебные уведомления о задачах и событиях;',
                'выполнять запросы к ИИ-помощнику и Telegram-боту по вашей команде;',
                'отвечать на обращения и оказывать поддержку;',
                'соблюдать требования законодательства и внутренних правил безопасности;',
                'улучшать систему — в обезличенном или агрегированном виде.',
              ]} />
              <p>
                <strong className="font-semibold text-surface-800 dark:text-surface-100">Правовые основания:</strong>{' '}
                исполнение трудового или гражданско-правового договора; ваше согласие — для
                необязательных функций (Telegram-бот, ИИ-помощник, голосовые сообщения);
                законные интересы компании — безопасность системы и предотвращение
                злоупотреблений; требования законодательства — кадровый и бухгалтерский учёт.
              </p>
              <p>
                Согласие можно отозвать в любой момент. Если обработка основана на договоре
                или законе, отзыв согласия может ограничить доступ к отдельным функциям,
                но не прекращает обработку, которую мы обязаны продолжать.
              </p>
              <p>
                Мы не продаём персональные данные, не передаём их рекламным сетям
                и не используем для таргетинга.
              </p>
            </Section>

            <Section id="cookies" title="4. Cookies и локальное хранилище">
              <p>Мы используем только технически необходимые cookie:</p>
              <List items={[
                'auth_token — идентификатор текущей сессии;',
                'refresh_token — продление сессии при повторном открытии системы.',
              ]} />
              <p>
                Обе cookie имеют флаги httpOnly и Secure: к ним нельзя получить доступ
                из JavaScript. Они сохраняются до 400 дней — это предел, который разрешает
                браузер; при каждом входе срок обновляется, а при выходе cookie удаляются.
              </p>
              <p>
                В localStorage браузера хранятся настройки интерфейса (тема, акцентный цвет),
                служебные отметки и токены сессии. Токены нужны, чтобы не вводить пароль
                при каждом открытии, и передаются серверу только для аутентификации.
                Пароли в localStorage не хранятся.
              </p>
              <p>Мы не используем рекламные и аналитические cookie третьих сторон.</p>
            </Section>

            <Section id="sharing" title="5. Кому мы передаём данные">
              <p>
                Для работы системы мы привлекаем поставщиков, которые обрабатывают данные
                по нашему поручению:
              </p>
              <List items={[
                'Supabase — размещение базы данных PostgreSQL;',
                'Railway — размещение серверной части;',
                'Vercel — размещение веб-версии;',
                'Brevo — отправка служебных писем;',
                'Google (Gemini API) — работа ИИ-помощника и распознавание голосовых сообщений;',
                'Groq (Whisper) — резервное распознавание голосовых сообщений;',
                'Telegram — доставка сообщений бота;',
                'Meta Platforms — если включена интеграция с Instagram.',
              ]} />
              <p>
                Эти сервисы могут находиться за пределами Республики Таджикистан. Мы передаём
                им только те данные, которые нужны для соответствующей функции, и требуем
                соблюдения конфиденциальности.
              </p>
              <p>
                Также мы можем раскрыть данные по законному требованию уполномоченных органов,
                для защиты прав и безопасности компании и пользователей, а при реорганизации —
                правопреемнику при условии сохранения конфиденциальности.
              </p>
            </Section>

            <Section id="retention" title="6. Сроки хранения">
              <List items={[
                'Данные аккаунта и рабочие данные — пока действует учётная запись, и до 1 года после её удаления, если закон не требует хранить дольше.',
                'Кадровые и финансовые документы — в сроки, установленные законодательством Республики Таджикистан.',
                'Журналы безопасности и технические логи — до 12 месяцев.',
                'Резервные копии, создаваемые нашей системой, — до 30 дней, после чего они перезаписываются.',
                'Запросы к боту и ИИ-помощнику — не дольше, чем нужно для выполнения запроса и обеспечения работы функции.',
              ]} />
              <p>Когда срок истекает, данные удаляются или обезличиваются.</p>
            </Section>

            <Section id="security" title="7. Как мы защищаем данные">
              <p>
                Соединение защищено HTTPS/TLS. Пароли хранятся только в виде хеша bcrypt.
                Веб-сессия защищена httpOnly и Secure cookie; мобильное приложение хранит
                токен в защищённом хранилище устройства. Refresh-токены хранятся на сервере
                в виде хеша и ротируются при каждом обновлении. В системе работают
                двухфакторная аутентификация, ролевой доступ, ограничение попыток входа,
                журналирование действий и ежедневное резервное копирование. Доступ к данным
                имеют только сотрудники, которым он необходим по работе.
              </p>
              <p>
                Ни один способ передачи и хранения не гарантирует абсолютную защиту.
                Если произойдёт утечка, затрагивающая ваши права, мы уведомим вас
                и уполномоченный орган в порядке, предусмотренном законодательством.
              </p>
            </Section>

            <Section id="rights" title="8. Ваши права">
              <p>Вы вправе:</p>
              <List items={[
                'получить информацию об обработке своих данных и копию этих данных;',
                'исправить неточные или неполные данные — самостоятельно в профиле или через администратора;',
                'требовать удаления данных или ограничения их обработки;',
                'отозвать согласие на обработку;',
                'возразить против обработки, если для неё нет обязательного основания;',
                'обжаловать действия оператора в уполномоченном органе по защите персональных данных.',
              ]} />
              <p>
                Запрос направьте на{' '}
                <a href="mailto:info@webrand.tj" className="underline underline-offset-4 hover:text-surface-900 dark:hover:text-surface-50">
                  info@webrand.tj
                </a>{' '}
                с темой «Персональные данные». Мы можем попросить подтвердить личность, чтобы
                не раскрыть данные постороннему. Срок ответа — до 30 календарных дней.
              </p>
              <p>
                Некоторые данные мы обязаны хранить по закону (например, кадровые
                и бухгалтерские документы). Их удаление возможно только после истечения
                установленного срока.
              </p>
            </Section>

            <Section id="deletion" title="9. Удаление аккаунта и данных">
              <p>
                Учётную запись создаёт и удаляет администратор агентства. Чтобы удалить аккаунт
                и связанные с ним данные, напишите на info@webrand.tj или обратитесь
                к администратору. Мы удалим данные, кроме тех, которые обязаны хранить
                по закону, и сообщим, что именно осталось и на каком основании.
              </p>
              <p>
                После удаления аккаунта доступ к системе прекращается. Резервные копии
                перезаписываются в течение 30 дней.
              </p>
            </Section>

            <Section id="children" title="10. Данные несовершеннолетних">
              <p>
                Система предназначена для сотрудников и подрядчиков и не адресована детям.
                Мы не собираем данные несовершеннолетних осознанно. Если такие данные
                попали в систему, сообщите нам — мы удалим их.
              </p>
            </Section>

            <Section id="changes" title="11. Изменения политики">
              <p>
                Мы можем обновлять эту политику. Актуальная редакция всегда доступна
                по адресу{' '}
                <a href="https://crm.webrand.tj/privacy-policy" className="underline underline-offset-4 hover:text-surface-900 dark:hover:text-surface-50">
                  crm.webrand.tj/privacy-policy
                </a>
                ; дата редакции указана в начале страницы. При существенных изменениях мы
                дополнительно сообщим в системе или по email.
              </p>
            </Section>

            <Section id="contacts" title="12. Контакты">
              <div className="rounded-2xl border border-surface-200 dark:border-surface-700 bg-surface-100/60 dark:bg-surface-900/60 p-4 sm:p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <MapPin size={16} className="mt-1 shrink-0 text-surface-400" />
                  <p className="text-sm leading-6">
                    ИП Бобоев Маҳмадсаид Мирзоалиевич<br />
                    Республика Таджикистан, г. Душанбе,<br />
                    р-н Шохмансур, ул. Абуабдуллохи Рудаки, 405
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Mail size={16} className="shrink-0 text-surface-400" />
                  <a href="mailto:info@webrand.tj" className="text-sm hover:underline underline-offset-4">
                    info@webrand.tj
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Phone size={16} className="shrink-0 text-surface-400" />
                  <a href="tel:+992988645543" className="text-sm hover:underline underline-offset-4">
                    +992 988 64 55 43
                  </a>
                </div>
              </div>
            </Section>
          </div>
        </article>

        <footer className="mt-6 flex flex-col items-center gap-2 text-center">
          <Link to="/auth" className="text-xs font-medium text-surface-500 hover:text-surface-800 dark:hover:text-surface-200 hover:underline underline-offset-4 transition-colors">
            Вернуться ко входу
          </Link>
          <p className="text-[11px] text-surface-400">
            © {new Date().getFullYear()} WeBrand · Sabt CRM
          </p>
        </footer>
      </main>
    </div>
  )
}
