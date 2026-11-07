import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileX, MapPin, Phone } from 'lucide-react'
import { publicScriptApi } from '@/services/api.service'

/** «пт, 30 октября» */
const dayLabel = (iso: string) => format(new Date(`${iso}T00:00:00`), 'EEEEEE, d MMMM', { locale: ru })

/** Страница клиента: инстаграм — как @имя, остальное — адрес без https://. */
function pageLabel(url: string): { label: string; text: string } {
  const ig = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(url)
  if (ig) return { label: 'Instagram', text: `@${ig[1]}` }
  return { label: 'Страница', text: url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '') }
}

/** Сценарий съёмки по ссылке из Telegram продюсеру (29.10.2026) — без входа
 *  и регистрации, только прочитать. Ссылка живёт, пока рилс не вышел.
 *  Страница всегда тёмная, как на макете: читают её с телефона на съёмке.
 *  С 07.11.2026 здесь всё о съёмке: адрес, кто встретит, СММ проекта,
 *  пожелания клиента — видеографу не нужно спрашивать это отдельно. */
export default function PublicScriptPage() {
  const { token = '' } = useParams<{ token: string }>()
  const { data, error, isLoading } = useQuery({
    queryKey: ['public-script', token],
    queryFn: () => publicScriptApi.get(token),
    retry: false,
    refetchOnWindowFocus: false,
  })
  const status = (error as any)?.response?.status
  const gone = status === 404 || status === 410
  const pr = data?.project
  const page = pr?.pageUrl ? pageLabel(pr.pageUrl) : null
  const label = 'text-[12.5px] font-semibold uppercase tracking-wider text-surface-400'
  const btn = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-surface-700 text-surface-50 text-[13.5px] font-semibold py-2.5 hover:bg-surface-600'

  useEffect(() => {
    document.title = data?.title ? `Сценарий — ${data.title}` : 'Сценарий съёмки'
  }, [data?.title])

  return (
    <div className="dark">
      <div className="min-h-screen bg-surface-900 text-surface-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-surface-700/70">
          <b className="text-[15px] tracking-wide">WeBrand</b>
          <span className="text-[13px] text-surface-400">съёмка</span>
        </header>

        <main className="flex-1 w-full max-w-xl mx-auto flex flex-col gap-4 px-5 pt-5 pb-8">
          {isLoading ? (
            <div className="space-y-3">
              <div className="h-8 w-3/4 rounded-lg bg-surface-800 animate-pulse" />
              <div className="h-40 rounded-2xl bg-surface-800 animate-pulse" />
            </div>
          ) : gone ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center py-16">
              <span className="w-[52px] h-[52px] rounded-full bg-surface-800 text-surface-400 grid place-items-center">
                <FileX size={24} />
              </span>
              <h1 className="text-xl font-bold">Ссылка больше не работает</h1>
              <p className="text-[14.5px] leading-relaxed text-surface-300 max-w-sm">
                Рилс уже вышел или его убрали из плана. Если съёмка ещё впереди — спросите сценарий у СММ-специалиста.
              </p>
            </div>
          ) : error || !data ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center py-16">
              <h1 className="text-xl font-bold">Не удалось открыть сценарий</h1>
              <p className="text-[14.5px] text-surface-300">Проверьте интернет и обновите страницу.</p>
            </div>
          ) : (
            <>
              <h1 className="text-2xl font-bold leading-tight" style={{ textWrap: 'balance' } as any}>
                {data.title ? `«${data.title}»` : 'Без названия'}
              </h1>

              <section className="flex flex-col gap-2">
                <span className={label}>Проект</span>
                <div className="rounded-2xl border border-surface-700 bg-surface-800 px-4 py-1">
                  <dl className="divide-y divide-surface-700/70">
                    {data.projectName && <Row label="Проект" value={data.projectName} />}
                    <Row label={pr?.otherPlace ? 'Место' : 'Адрес'} value={pr?.address || 'не указан — уточните у СММ'} muted={!pr?.address} />
                  </dl>
                  {(pr?.mapUrl || pr?.phone) && (
                    <div className="flex gap-2 pb-3 pt-0.5">
                      {pr?.mapUrl && (
                        <a href={pr.mapUrl} target="_blank" rel="noreferrer" className={btn}>
                          <MapPin size={15} /> Открыть карту
                        </a>
                      )}
                      {pr?.phone && (
                        <a href={`tel:${pr.phone}`} className={btn}>
                          <Phone size={15} /> Позвонить
                        </a>
                      )}
                    </div>
                  )}
                  {(pr?.contact || page || pr?.smm) && (
                    <dl className="divide-y divide-surface-700/70 border-t border-surface-700/70">
                      {pr?.contact && <Row label="На месте" value={pr.contact} />}
                      {page && pr?.pageUrl && (
                        <div className="flex justify-between gap-3 py-2.5 text-sm">
                          <dt className="text-surface-400 shrink-0">{page.label}</dt>
                          <dd className="font-semibold text-right min-w-0 break-words">
                            <a href={pr.pageUrl} target="_blank" rel="noreferrer" className="text-primary-300 hover:underline">{page.text}</a>
                          </dd>
                        </div>
                      )}
                      {pr?.smm && <Row label="СММ" value={pr.smm} />}
                    </dl>
                  )}
                </div>
              </section>

              <section className="flex flex-col gap-2">
                <span className={label}>Съёмка</span>
                <dl className="rounded-2xl border border-surface-700 bg-surface-800 px-4 py-1 divide-y divide-surface-700/70">
                  {data.shoot?.date && (
                    <Row label="Когда" value={`${dayLabel(data.shoot.date)}${data.shoot.time ? `, ${data.shoot.time}` : ''}`} />
                  )}
                  {data.shoot?.date && !data.shoot.time && <Row label="Время" value="не указано — уточните у СММ" muted />}
                  {data.shoot && <Row label="Снимает" value={data.shoot.videographer || 'видеограф не назначен'} />}
                  {data.publishDate && <Row label="Выход" value={dayLabel(data.publishDate)} />}
                </dl>
              </section>

              {pr?.preferences && (
                <section className="flex flex-col gap-2">
                  <span className={label}>Пожелания клиента</span>
                  <div className="text-[15px] leading-relaxed text-surface-100 whitespace-pre-line break-words">{pr.preferences}</div>
                </section>
              )}

              <section className="flex flex-col gap-2">
                <span className={label}>Сценарий</span>
                {data.script ? (
                  <div className="text-base leading-relaxed text-surface-50 whitespace-pre-line break-words">{data.script}</div>
                ) : (
                  <p className="text-[15px] text-surface-300">Сценария пока нет — его добавит СММ-специалист.</p>
                )}
              </section>

              <p className="mt-auto pt-4 text-[12.5px] leading-relaxed text-surface-400">
                {data.updatedAt && `Обновлено ${format(new Date(data.updatedAt), "d MMMM 'в' HH:mm", { locale: ru })}. `}
                Сценарий ведёт СММ-специалист в CRM — здесь всегда последняя версия.
              </p>
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-2.5 text-sm">
      <dt className="text-surface-400 shrink-0">{label}</dt>
      <dd className={muted ? 'text-right text-surface-400' : 'font-semibold text-right min-w-0 break-words'}>{value}</dd>
    </div>
  )
}
