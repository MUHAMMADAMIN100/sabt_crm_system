import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, Film, Image as ImageIcon, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { projectsApi, contentPlanApi } from '@/services/api.service'
import { DatePicker } from '@/components/ui/DatePicker'

const inp = 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2.5 text-sm outline-none focus:border-gray-400 dark:focus:border-gray-500 w-full'
const card = 'rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5'
const secLabel = 'text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-3'

// Отдельная страница создания SMM-проекта (упрощённый шаблон: цикл/норма/сторис + клиент).
// Не использует общую dev-форму. Проект создаётся сразу с типом SMM и smmData (без тарифа).
export default function SmmProjectCreatePage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
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

  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const spmNum = parseInt(spm, 10)
  const perDay = Number.isFinite(spmNum) && spmNum > 0 ? Math.max(1, Math.round(spmNum / daysInMonth)) : 0

  const createMut = useMutation({
    mutationFn: async () => {
      const n = (s: string) => { const v = parseInt(s, 10); return Number.isFinite(v) ? v : undefined }
      const smmData: Record<string, any> = { normReels: n(reels) ?? 0, normPosts: n(posts) ?? 0 }
      const d = n(day); if (d) smmData.cycleStartDay = d
      const m = n(spm)
      if (m != null) { smmData.storiesPerMonth = m; smmData.storiesPerDay = m > 0 ? Math.max(1, Math.round(m / 30)) : 0 }
      if (ownerName.trim()) smmData.ownerName = ownerName.trim()
      if (keyDate) smmData.keyDate = keyDate
      if (keyDateNote.trim()) smmData.keyDateNote = keyDateNote.trim()
      if (collabSince) smmData.collabSince = collabSince
      if (preferences.trim()) smmData.preferences = preferences.trim()
      const created: any = await projectsApi.create({ name: name.trim(), projectType: 'SMM', allowNoTariff: true, smmData })
      // Генерируем контент-план по норме (как при сохранении цикла) — чтобы сразу было что планировать.
      if (created?.id) {
        try { await contentPlanApi.smartGenerate({ projectId: created.id, reels: smmData.normReels, posts: smmData.normPosts }) }
        catch { /* нет прав/ошибка — проект уже создан, контент можно добавить позже */ }
      }
      return created
    },
    onSuccess: (created: any) => {
      qc.invalidateQueries({ queryKey: ['smm-calendar'] })
      toast.success('Проект создан')
      navigate(created?.id ? `/smm/projects/${created.id}` : '/smm/projects')
    },
    onError: (e: any) => toast.error(e?.response?.data?.message || 'Не удалось создать проект'),
  })

  const submit = () => {
    if (!name.trim()) { toast.error('Введите название'); return }
    createMut.mutate()
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Link to="/smm/projects" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"><ChevronLeft size={16} /> Проекты</Link>
      <h1 className="text-2xl font-bold tracking-tight">Новый SMM-проект</h1>

      <div className={card}>
        <h2 className={secLabel}>Основное</h2>
        <label className="block"><span className="text-xs text-gray-500">Название *</span>
          <input value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit() }} placeholder="Напр. Yalla Coffee" className={inp + ' mt-1'} autoFocus /></label>
      </div>

      <div className={card}>
        <h2 className={secLabel}>Цикл и норма</h2>
        <div className="grid grid-cols-3 gap-3">
          <label className="block"><span className="text-xs text-gray-500">День старта цикла</span><input type="number" min={1} max={31} value={day} onChange={e => setDay(e.target.value)} className={inp + ' mt-1'} /></label>
          <label className="block"><span className="text-xs text-gray-500 inline-flex items-center gap-1"><Film size={13} /> Рилс за цикл</span><input type="number" min={0} value={reels} onChange={e => setReels(e.target.value)} className={inp + ' mt-1'} /></label>
          <label className="block"><span className="text-xs text-gray-500 inline-flex items-center gap-1"><ImageIcon size={13} /> Пост за цикл</span><input type="number" min={0} value={posts} onChange={e => setPosts(e.target.value)} className={inp + ' mt-1'} /></label>
        </div>
        <label className="block mt-3"><span className="text-xs text-gray-500">Сторис в месяц</span>
          <input type="number" min={0} value={spm} onChange={e => setSpm(e.target.value)} placeholder="напр. 90" className={inp + ' mt-1 max-w-[160px]'} /></label>
        <p className="text-[11.5px] text-gray-400 mt-1.5">{perDay > 0 ? `Распределится равномерно: ≈ ${perDay}/день. По этой норме красятся дни на «Сторисы».` : 'Не задано — статус сторис не считается.'}</p>
      </div>

      <div className={card}>
        <h2 className={secLabel}>О клиенте</h2>
        <label className="block"><span className="text-xs text-gray-500">Владелец бизнеса</span><input value={ownerName} onChange={e => setOwnerName(e.target.value)} placeholder="Имя" className={inp + ' mt-1'} /></label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          <label className="block"><span className="text-xs text-gray-500">Значимый день</span><DatePicker value={keyDate} onChange={setKeyDate} placeholder="дата" className="mt-1" /></label>
          <label className="block"><span className="text-xs text-gray-500">Комментарий к дню</span><input value={keyDateNote} onChange={e => setKeyDateNote(e.target.value)} placeholder="Напр. День рождения" className={inp + ' mt-1'} /></label>
        </div>
        <label className="block mt-3"><span className="text-xs text-gray-500">Сотрудничаем с</span><DatePicker value={collabSince} onChange={setCollabSince} placeholder="дата" className="mt-1 max-w-[220px]" /></label>
        <label className="block mt-3"><span className="text-xs text-gray-500">Предпочтения</span><textarea value={preferences} onChange={e => setPreferences(e.target.value)} rows={4} placeholder="Тон, что любят/не любят, правила согласования…" className={inp + ' mt-1 resize-y leading-relaxed'} /></label>
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => navigate('/smm/projects')} className="text-sm font-semibold px-4 py-2.5 rounded-xl text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">Отмена</button>
        <button onClick={submit} disabled={createMut.isPending || !name.trim()}
          className="inline-flex items-center gap-2 text-sm font-bold px-5 py-2.5 rounded-xl bg-primary-600 text-white hover:brightness-110 disabled:opacity-60">
          {createMut.isPending && <Loader2 size={15} className="animate-spin" />} Создать проект
        </button>
      </div>
    </div>
  )
}
