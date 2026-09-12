import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Film, Image as ImageIcon, Loader2, X, ArrowRight, ArrowLeft, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsApi, contentPlanApi } from '@/services/api.service'
import { DatePicker } from '@/components/ui/DatePicker'

const inp = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500 w-full'

// Модалка создания SMM-проекта — мастер из 2 шагов: ① проект и норма → ② клиент.
// «Создать» → проект (тип SMM, smmData одним запросом, без тарифа) → генерация контента → страница проекта.
export default function SmmProjectCreateModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [step, setStep] = useState<1 | 2>(1)
  const [name, setName] = useState('')
  const [day, setDay] = useState('1')
  const [reels, setReels] = useState('4')
  const [posts, setPosts] = useState('4')
  const [spm, setSpm] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [keyDate, setKeyDate] = useState('')
  const [keyDateNote, setKeyDateNote] = useState('')
  const [collabSince, setCollabSince] = useState('')
  const [preferences, setPreferences] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const spmNum = parseInt(spm, 10)
  const perDay = Number.isFinite(spmNum) && spmNum > 0 ? Math.max(1, Math.round(spmNum / daysInMonth)) : 0

  const createMut = useMutation({
    mutationFn: async () => {
      const n = (s: string) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : undefined }
      const smmData: Record<string, any> = { normReels: n(reels) ?? 0, normPosts: n(posts) ?? 0 }
      const d = n(day); if (d) smmData.cycleStartDay = d
      const m = n(spm)
      if (m != null) { smmData.storiesPerMonth = m; smmData.storiesPerDay = m > 0 ? Math.max(1, Math.round(m / new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate())) : 0 } // месяц / дни текущего месяца
      if (ownerName.trim()) smmData.ownerName = ownerName.trim()
      if (keyDate) smmData.keyDate = keyDate
      if (keyDateNote.trim()) smmData.keyDateNote = keyDateNote.trim()
      if (collabSince) smmData.collabSince = collabSince
      if (preferences.trim()) smmData.preferences = preferences.trim()
      const created: any = await projectsApi.create({ name: name.trim(), projectType: 'SMM', allowNoTariff: true, smmData })
      if (created?.id) {
        try { await contentPlanApi.smartGenerate({ projectId: created.id, reels: smmData.normReels, posts: smmData.normPosts }) }
        catch { /* нет прав/ошибка — проект уже создан */ }
      }
      return created
    },
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ['smm-calendar'] })
      toast.success('Проект создан')
      onClose()
      navigate(created?.id ? `/smm/projects/${created.id}` : '/smm/projects')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось создать проект'),
  })

  const next = () => {
    if (!name.trim()) { toast.error('Введите название'); return }
    setStep(2)
  }
  const submit = () => {
    if (!name.trim()) { setStep(1); toast.error('Введите название'); return }
    createMut.mutate()
  }

  // Кружок шага в степпере: done — галочка, active — номер на акценте, else — бледный.
  const dot = (n: 1 | 2, label: string) => {
    const active = step === n
    const done = step > n
    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className={`w-6 h-6 rounded-full grid place-items-center text-[12px] font-bold shrink-0 ${
          done ? 'bg-primary-600 text-white' : active ? 'bg-primary-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'}`}>
          {done ? <Check size={13} /> : n}
        </span>
        <span className={`text-[12.5px] font-semibold truncate ${active || done ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>{label}</span>
      </div>
    )
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 py-8 bg-black/50 overflow-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-lg font-bold leading-tight">Новый SMM-проект</h2>
            <p className="text-xs text-gray-400 mt-0.5">{step === 1 ? 'Шаг 1 из 2 — проект и норма' : 'Шаг 2 из 2 — данные клиента'}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="flex items-center gap-3 px-5 pt-4">
          {dot(1, 'Проект и норма')}
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          {dot(2, 'Клиент')}
        </div>

        <div className="p-5 space-y-4">
          {step === 1 ? (
            <>
              <div>
                <label className="block"><span className="text-xs text-gray-500">Название *</span>
                  <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') next() }} placeholder="Напр. Yalla Coffee" className={inp + ' mt-1'} autoFocus /></label>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <label className="block"><span className="text-xs text-gray-500">День старта</span><input type="number" min={1} max={31} value={day} onChange={e => setDay(e.target.value)} className={inp + ' mt-1 no-spin'} /></label>
                <label className="block"><span className="text-xs text-gray-500 inline-flex items-center gap-1"><Film size={13} /> Рилс/цикл</span><input type="number" min={0} value={reels} onChange={e => setReels(e.target.value)} className={inp + ' mt-1 no-spin'} /></label>
                <label className="block"><span className="text-xs text-gray-500 inline-flex items-center gap-1"><ImageIcon size={13} /> Пост/цикл</span><input type="number" min={0} value={posts} onChange={e => setPosts(e.target.value)} className={inp + ' mt-1 no-spin'} /></label>
              </div>
              <div>
                <label className="block"><span className="text-xs text-gray-500">Сторис в месяц</span>
                  <div className="flex items-stretch gap-2 mt-1">
                    <input type="number" min={0} value={spm} onChange={e => setSpm(e.target.value)} placeholder="напр. 90" className={inp + ' flex-1 no-spin'} />
                    <span className="inline-flex items-center whitespace-nowrap rounded-lg border border-gray-200 dark:border-gray-700 bg-primary-50 dark:bg-primary-900/20 px-3.5 text-sm font-bold tabular-nums text-primary-700 dark:text-primary-300">
                      ≈ {perDay > 0 ? perDay : '—'}/день
                    </span>
                  </div></label>
                <p className="text-[11.5px] text-gray-400 mt-1.5">{perDay > 0 ? 'Распределится равномерно по дням месяца. По этой норме красятся дни на «Сторисы».' : 'Не задано — статус сторис не считается.'}</p>
              </div>
            </>
          ) : (
            <>
              <label className="block"><span className="text-xs text-gray-500">Владелец бизнеса</span><input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Имя" className={inp + ' mt-1'} autoFocus /></label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block"><span className="text-xs text-gray-500">Значимый день</span><DatePicker value={keyDate} onChange={setKeyDate} placeholder="дата" className="mt-1" /></label>
                <label className="block"><span className="text-xs text-gray-500">Комментарий к дню</span><input value={keyDateNote} onChange={e => setKeyDateNote(e.target.value)} placeholder="Напр. День рождения" className={inp + ' mt-1'} /></label>
              </div>
              <label className="block"><span className="text-xs text-gray-500">Сотрудничаем с</span><DatePicker value={collabSince} onChange={setCollabSince} placeholder="дата" className="mt-1 max-w-[220px]" /></label>
              <label className="block"><span className="text-xs text-gray-500">Предпочтения</span><textarea value={preferences} onChange={e => setPreferences(e.target.value)} rows={3} placeholder="Тон, что любят/не любят, правила согласования…" className={inp + ' mt-1 resize-y leading-relaxed'} /></label>
            </>
          )}
        </div>

        <div className="flex justify-between items-center gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          {step === 1 ? (
            <button onClick={onClose} className="text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
          ) : (
            <button onClick={() => setStep(1)} className="inline-flex items-center gap-1.5 text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ArrowLeft size={15} /> Назад</button>
          )}
          {step === 1 ? (
            <button onClick={next} disabled={!name.trim()}
              className="inline-flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-primary-600 text-white hover:brightness-110 disabled:opacity-60">
              Далее <ArrowRight size={15} />
            </button>
          ) : (
            <button onClick={submit} disabled={createMut.isPending || !name.trim()}
              className="inline-flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-primary-600 text-white hover:brightness-110 disabled:opacity-60">
              {createMut.isPending && <Loader2 size={15} className="animate-spin" />} Создать проект
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
