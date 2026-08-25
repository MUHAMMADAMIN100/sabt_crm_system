import { Megaphone } from 'lucide-react'

/** «СММ» — раздел-заглушка в главном сайдбаре. Содержимое настроим позже. */
export default function SmmPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Megaphone size={22} /> СММ</h1>
        <p className="text-sm text-surface-500">Раздел SMM.</p>
      </header>
      <div className="rounded-2xl border border-dashed border-surface-300 p-12 text-center">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-surface-100 text-surface-400">
          <Megaphone size={30} />
        </div>
        <h2 className="text-lg font-semibold">Раздел в разработке</h2>
        <p className="mt-1 text-sm text-surface-500 max-w-md mx-auto">
          Здесь появится SMM-раздел — содержимое настроим позже.
        </p>
      </div>
    </div>
  )
}
