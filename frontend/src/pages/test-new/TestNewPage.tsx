// «Тест новый» — печатаешь текст, жмёшь «Скачать» и получаешь аккуратный PDF.
//
// Раздел намеренно простой: поле заголовка, поле текста, кнопка. Всё
// собирается в браузере через pdfmake (он уже в проекте и везёт с собой
// шрифт с кириллицей) — сервер не участвует, файл не хранится.
import { useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'

const TODAY = () => new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })

export default function TestNewPage() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const words = body.trim() ? body.trim().split(/\s+/).length : 0
  const canDownload = !busy

  async function download() {
    if (busy) return
    if (!body.trim()) { toast.error('Сначала напишите текст'); return }
    setBusy(true)
    try {
      // Грузим pdfmake по требованию: он весит прилично, и незачем тянуть его
      // в общий бандл ради страницы, куда заходят редко.
      const [pdfModule, fontsModule] = await Promise.all([
        import('pdfmake/build/pdfmake'),
        import('pdfmake/build/vfs_fonts'),
      ])
      const pdfMake: any = (pdfModule as any).default || pdfModule
      // Шрифты подключаются по-разному в зависимости от версии pdfmake:
      // в 0.3 это addVirtualFileSystem(модуль), в 0.2 — присваивание vfs.
      // Поддерживаем оба, иначе сборка документа падает на первом же шрифте.
      const f: any = (fontsModule as any).default ?? fontsModule
      if (typeof pdfMake.addVirtualFileSystem === 'function') {
        pdfMake.addVirtualFileSystem(f)
      } else {
        pdfMake.vfs = f.vfs ?? f.pdfMake?.vfs ?? f
      }
      // В 0.3 карта шрифтов больше не зашита внутрь — объявляем сами.
      // Лишним не будет и в 0.2: имена файлов те же.
      pdfMake.fonts = pdfMake.fonts || {
        Roboto: {
          normal: 'Roboto-Regular.ttf',
          bold: 'Roboto-Medium.ttf',
          italics: 'Roboto-Italic.ttf',
          bolditalics: 'Roboto-MediumItalic.ttf',
        },
      }

      const heading = title.trim() || 'Без названия'
      // Пустая строка = новый блок. Иначе весь текст слипся бы в одну простыню.
      const blocks = body.replace(/\r/g, '').split(/\n{2,}/)
        .map(b => b.trim()).filter(Boolean)

      // Блок, где КАЖДАЯ строка начинается с маркера, становится настоящим
      // списком на листе: с отступом и висячей строкой, а не строкой,
      // начинающейся с дефиса.
      const BULLET = /^[-*•–—]\s+/
      const NUMBER = /^\d+[.)]\s+/
      const P = { fontSize: 11.5, lineHeight: 1.45, color: '#27272a', margin: [0, 0, 0, 12] }
      const content = blocks.map((block) => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
        if (lines.length && lines.every(l => BULLET.test(l))) {
          return { ...P, ul: lines.map(l => l.replace(BULLET, '')), markerColor: '#71717a' }
        }
        if (lines.length && lines.every(l => NUMBER.test(l))) {
          return { ...P, ol: lines.map(l => l.replace(NUMBER, '')), markerColor: '#71717a' }
        }
        return { ...P, text: block, alignment: 'justify', preserveLeadingSpaces: true }
      })

      const doc: any = {
        pageSize: 'A4',
        pageMargins: [56, 92, 56, 64],
        info: { title: heading },
        // Шапка-полоса с названием и датой — на каждой странице.
        header: () => ({
          margin: [56, 34, 56, 0],
          stack: [
            { text: heading, fontSize: 18, bold: true, color: '#18181b' },
            { text: TODAY(), fontSize: 9.5, color: '#8a8a93', margin: [0, 5, 0, 10] },
            { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 483, y2: 0, lineWidth: 1, lineColor: '#e4e4e7' }] },
          ],
        }),
        footer: (page: number, total: number) => ({
          margin: [56, 16, 56, 0],
          columns: [
            { text: 'Sabt', fontSize: 9, color: '#a1a1aa' },
            { text: `${page} из ${total}`, fontSize: 9, color: '#a1a1aa', alignment: 'right' },
          ],
        }),
        content,
        defaultStyle: { font: 'Roboto' },
      }
      const safeName = heading.replace(/[\\/:*?"<>|]/g, ' ').slice(0, 60).trim() || 'Документ'
      const file = `${safeName}.pdf`
      const built = pdfMake.createPdf(doc)
      if (typeof built.download === 'function') {
        built.download(file)
      } else {
        // Запасной путь: собираем файл сами и кликаем по ссылке.
        built.getBlob((blob: Blob) => {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = file
          a.click()
          setTimeout(() => URL.revokeObjectURL(url), 5000)
        })
      }
    } catch (e: any) {
      // Показываем НАСТОЯЩУЮ причину: «не работает кнопка» без текста ошибки
      // не даёт понять, что именно сломалось.
      // eslint-disable-next-line no-console
      console.error('PDF:', e)
      toast.error(`Не удалось собрать PDF: ${e?.message || e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Тест новый</h1>
        <p className="text-sm text-surface-500 mt-1">Напечатайте текст и скачайте его в PDF.</p>
      </div>

      <div className="card flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-surface-500">Заголовок</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Например, «Коммерческое предложение»"
            className="input"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-semibold text-surface-500">Текст</span>
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={16}
            placeholder={'Пишите здесь.\n\nПустая строка начинает новый абзац.\n\nСтроки с «-» станут маркированным списком, строки с «1.» — нумерованным.'}
            className="input resize-y min-h-[280px] leading-relaxed"
          />
        </label>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={download}
            disabled={!canDownload}
            className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            Скачать PDF
          </button>
          <span className="text-[12.5px] text-surface-500 flex items-center gap-1.5">
            <FileText size={14} />
            {words ? `${words} сл. · A4 · ${TODAY()}` : 'Пока пусто — напишите текст'}
          </span>
        </div>
      </div>
    </div>
  )
}
