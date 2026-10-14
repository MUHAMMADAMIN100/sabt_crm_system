// Окно «Новый проект разработки» (макет 14.10.2026). Раньше проект
// разработки создавался окном SMM-проекта: спрашивал рилсы, посты и сторис
// за цикл и сам заводил в проекте рилсы и посты. Здесь — только то, что
// нужно разработке: название, тип, проект-менеджер, срок сдачи и клиент.
// Новый проект начинается с этапа 1 (сбор требований и ТЗ).
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import clsx from 'clsx'
import { devTrackerApi, projectsApi } from '@/services/api.service'
import { Modal } from '@/components/ui'
import { DatePicker } from '@/components/ui/DatePicker'
import { DEV_PROJECT_TYPES } from '@/lib/projectType'
import { DEV_STAGES } from '@/lib/devStages'
import { todayIso } from '../devProjects'

/** Кого можно поставить проект-менеджером. */
const PM_ROLES = ['pm_dev', 'dev_director']

const fieldCls = 'flex flex-col gap-1.5 text-[13px] text-surface-600 dark:text-surface-300 min-w-0'

export default function DevProjectCreateModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [type, setType] = useState<string>(DEV_PROJECT_TYPES[0])
  const [managerId, setManagerId] = useState('')
  const [endDate, setEndDate] = useState('')
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)

  // Проект-менеджеры — из исполнителей доски (активные роли разработки;
  // список открыт всем, кто видит доску). Не загрузился — поля нет:
  // проект-менеджером станет создатель, сменить можно в блоке «Команда».
  const { data: people, isError } = useQuery({
    queryKey: ['dev-tracker', 'assignees'],
    queryFn: () => devTrackerApi.assignees(),
    retry: false,
    staleTime: 60_000,
  })
  const pms = useMemo(() => (people ?? [])
    .filter(u => PM_ROLES.includes(u.role ?? ''))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru')), [people])
  const firstStage = useMemo(() => DEV_STAGES[0], [])

  async function create() {
    const title = name.trim()
    if (!title) { toast.error('Введите название проекта'); return }
    if (saving) return
    const clientInfo: Record<string, string> = {}
    if (company.trim()) clientInfo.companyName = company.trim()
    if (contact.trim()) clientInfo.contactPerson = contact.trim()
    if (phone.trim()) clientInfo.phone = phone.trim()
    setSaving(true)
    try {
      const created: any = await projectsApi.create({
        name: title,
        projectType: type,
        startDate: todayIso(),
        ...(managerId ? { managerId } : {}),
        ...(endDate ? { endDate } : {}),
        ...(Object.keys(clientInfo).length ? { clientInfo } : {}),
      })
      // Этап 1 — сразу: проект без этапа на странице выглядел бы «не начатым».
      if (created?.id) await projectsApi.setDevStage(created.id, firstStage.num).catch(() => undefined)
      qc.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Проект создан')
      onClose()
      navigate(created?.id ? `/dev/projects/${created.id}` : '/dev/projects')
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Не удалось создать проект')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Новый проект разработки" size="md" closeOnBackdropClick={false}>
      <form className="flex flex-col gap-4" onSubmit={e => { e.preventDefault(); create() }}>
        <label className={fieldCls}>Название *
          <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Например, Лендинг клиники" />
        </label>

        <fieldset className="flex flex-col gap-2 min-w-0">
          <legend className="text-[13px] text-surface-600 dark:text-surface-300 mb-2">Тип</legend>
          <div className="flex flex-wrap gap-1.5">
            {DEV_PROJECT_TYPES.map(t => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
                className={clsx('text-[13px] rounded-full px-3 py-1.5 border transition-colors',
                  type === t
                    ? 'font-semibold border-[#2D5DA8] bg-[#E7EEF9] text-[#244C8C] dark:bg-[#2D5DA8]/25 dark:text-[#A9C1EA] dark:border-[#6F95D6]'
                    : 'border-surface-300 dark:border-surface-600 text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700')}>
                {t}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!isError && (
            <label className={fieldCls}>Проект-менеджер
              <select className="input min-h-[38px]" value={managerId} onChange={e => setManagerId(e.target.value)}>
                <option value="">Выбрать</option>
                {pms.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </label>
          )}
          <div className={fieldCls}>
            <span>Срок сдачи</span>
            <DatePicker value={endDate} onChange={setEndDate} placeholder="Выберите дату" />
          </div>
        </div>

        <div className="flex flex-col gap-2.5 pt-3 border-t border-surface-200 dark:border-surface-700">
          <span className="text-[13px] font-semibold text-surface-800 dark:text-surface-100">Клиент</span>
          <label className={fieldCls}>Компания
            <input className="input" value={company} onChange={e => setCompany(e.target.value)} placeholder="Название компании" />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className={fieldCls}>Контактное лицо
              <input className="input" value={contact} onChange={e => setContact(e.target.value)} placeholder="Имя" />
            </label>
            <label className={fieldCls}>Телефон
              <input className="input" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+992" />
            </label>
          </div>
        </div>

        <p className="text-[13px] leading-relaxed text-surface-600 dark:text-surface-300 bg-surface-100 dark:bg-surface-900 rounded-lg px-3 py-2.5">
          Новый проект начинается с этапа {firstStage.num} · {firstStage.label} ({firstStage.pct} %).
        </p>

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">Отмена</button>
          <button type="submit" disabled={saving || !name.trim()}
            className="inline-flex items-center justify-center gap-2 min-h-[34px] px-4 rounded-lg text-sm font-semibold text-white bg-[#2D5DA8] hover:bg-[#244C8C] disabled:opacity-60">
            {saving && <Loader2 size={15} className="animate-spin" />} Создать проект
          </button>
        </div>
      </form>
    </Modal>
  )
}
