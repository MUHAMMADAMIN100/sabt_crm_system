import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { FileX } from 'lucide-react'
import { publicScriptApi } from '@/services/api.service'

/** «пт, 30 октября» */
const dayLabel = (iso: string) => format(new Date(`${iso}T00:00:00`), 'EEEEEE, d MMMM', { locale: ru })

/** Сценарий съёмки по ссылке из Telegram продюсеру (29.10.2026) — без входа
 *  и регистрации, только прочитать. Ссылка живёт, пока рилс не вышел.
 *  Страница всегда тёмная, как на макете: читают её с телефона на съёмке. */
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

  useEffect(() => {
    document.title = data?.title ? `Сценарий — ${data.title}` : 'Сценарий съёмки'
  }, [data?.title])

  return (
    <div className="dark">
      <div className="min-h-screen bg-surface-900 text-surface-50 flex flex-col">
        <header className="flex items-center justify-between px-5 py-4 border-b border-surface-700/70">
          <b className="text-[15px] tracking-wide">WeBrand</b>
          <span className="text-[13px] text-surface-400">сценарий съёмки</span>
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

              <dl className="rounded-2xl border border-surface-700 bg-surface-800 px-4 py-1 divide-y divide-surface-700/70">
                {data.projectName && <Row label="Клиент" value={data.projectName} />}
                {data.shoot?.date && (
                  <Row label="Съёмка" value={`${dayLabel(data.shoot.date)}${data.shoot.time ? `, ${data.shoot.time}` : ''}`} />
                )}
                {data.shoot && <Row label="Снимает" value={data.shoot.videographer || 'видеограф не назначен'} />}
                {data.publishDate && <Row label="Выход" value={dayLabel(data.publishDate)} />}
              </dl>

              <section className="flex flex-col gap-2">
                <span className="text-[12.5px] font-semibold uppercase tracking-wider text-surface-400">Сценарий</span>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-2.5 text-sm">
      <dt className="text-surface-400">{label}</dt>
      <dd className="font-semibold text-right">{value}</dd>
    </div>
  )
}
