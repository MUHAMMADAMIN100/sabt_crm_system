import { useState } from 'react'
import { Stamp, Play } from 'lucide-react'
import { useAuthStore } from '@/store/auth.store'
import {
  canCelebrateTasks, celebrateTask, isCelebrationSoundOn, setCelebrationSoundOn,
} from '@/lib/taskCelebration'

/** Настройка «Печати успеха». Видна тем же ролям, что и сама анимация. */
export default function TaskCelebrationSection() {
  const user = useAuthStore(s => s.user)
  const [sound, setSound] = useState(isCelebrationSoundOn)

  if (!canCelebrateTasks(user)) return null

  const toggle = (on: boolean) => {
    setCelebrationSoundOn(on)
    setSound(on)
  }

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <Stamp size={16} className="text-primary-600 dark:text-primary-400" />
        <h3 className="section-title">Печать за выполненную задачу</h3>
      </div>
      <p className="text-xs text-surface-500 dark:text-surface-400 mb-3">
        Когда вы переводите задачу в «Выполнено», на экране на пару секунд появляется лист с печатью
        «THE BEST». Видите её только вы. Клик по экрану закрывает анимацию сразу.
      </p>

      <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300 cursor-pointer mb-3">
        <input
          type="checkbox"
          className="w-4 h-4"
          checked={sound}
          onChange={e => toggle(e.target.checked)}
        />
        Звук удара штампа
      </label>

      <button
        type="button"
        // Ключ отличается от любого id задачи, поэтому пример можно смотреть
        // сколько угодно раз — защита от повтора его не глушит.
        onClick={() => celebrateTask(`preview-${Date.now()}`)}
        className="btn-secondary text-sm inline-flex items-center gap-2"
      >
        <Play size={14} /> Показать пример
      </button>
    </div>
  )
}
