// Каталог кастинга для клиентов (17.11.2026, docs/CASTING_SPEC.md §4–5) —
// без входа, по ссылке /public/casting. Фирменный вид артефакта «WeBrand
// Casting»: тёмная сцена, лаймовый акцент, шрифты Unbounded / Manrope /
// JetBrains Mono (Google Fonts подключаем только на этой странице).
// «Забронировать» не уводит в Telegram, а отправляет заявку: на сервере она
// становится лидом в «Продажах».
//
// Стили — свои, с префиксом wbc-, а не Tailwind: страница повторяет макет
// артефакта один в один, и общие классы CRM (.chip, .badge) её не задевают.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { photoUrl, publicCastingApi } from '@/services/casting.api'
import {
  CASTING_TABS, TAG_LABEL, TAG_ORDER, ageText, bookingError, categoriesText, filterCatalog, heightText, linkItems,
  orderedTags, splitName, tabCounts,
} from '@/lib/casting'
import type { CastingTab, CastingTag, PublicTalent } from '@/types/casting'

const FONTS_HREF = 'https://fonts.googleapis.com/css2?family=Unbounded:wght@500;700;800&family=Manrope:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700&display=swap'

/** Шрифты и фон страницы — только пока она открыта. */
function usePageChrome() {
  useEffect(() => {
    const prevTitle = document.title
    document.title = 'WeBrand Casting'
    const added: HTMLElement[] = []
    if (!document.getElementById('wbc-fonts')) {
      const pre = document.createElement('link')
      pre.rel = 'preconnect'; pre.href = 'https://fonts.gstatic.com'; pre.crossOrigin = ''
      const css = document.createElement('link')
      css.id = 'wbc-fonts'; css.rel = 'stylesheet'; css.href = FONTS_HREF
      document.head.append(pre, css)
      added.push(pre, css)
    }
    // Фон под «резинкой» прокрутки и под чёлкой — тёмный, как страница.
    const html = document.documentElement
    const prevBg = document.body.style.background
    const prevScheme = html.style.colorScheme
    document.body.style.background = '#0B0D12'
    html.style.colorScheme = 'dark'
    return () => {
      document.title = prevTitle
      added.forEach(el => el.remove())
      document.body.style.background = prevBg
      html.style.colorScheme = prevScheme
    }
  }, [])
}

const ARROW = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
)

type Contact = { name: string; phone: string; comment: string }

export default function PublicCastingPage() {
  usePageChrome()
  const [params, setParams] = useSearchParams()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['public-casting'],
    queryFn: publicCastingApi.list,
    retry: 1,
    refetchOnWindowFocus: false,
  })
  const all = data?.items || []

  const [tab, setTab] = useState<CastingTab>('all')
  const [tags, setTags] = useState<CastingTag[]>([])
  const [q, setQ] = useState('')
  const counts = useMemo(() => tabCounts(all), [all])
  const list = useMemo(() => filterCatalog(all, { tab, tags, q }), [all, tab, tags, q])
  // Имя и телефон клиента помним, пока страница открыта: вторую заявку
  // не нужно заполнять заново.
  const [contact, setContact] = useState<Contact>({ name: '', phone: '', comment: '' })

  // Открытый человек — в адресе (?id=…): ссылкой на него можно поделиться,
  // а «Назад» на телефоне закрывает карточку.
  const openId = params.get('id')
  const open = openId ? all.find(t => t.id === openId) || null : null
  const openTalent = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('id', id)
    setParams(next, { state: { wbcOpened: true } })
  }
  const close = () => {
    if ((window.history.state?.usr as any)?.wbcOpened) { window.history.back(); return }
    const next = new URLSearchParams(params)
    next.delete('id')
    setParams(next, { replace: true })
  }

  const toggleTag = (t: CastingTag) =>
    setTags(prev => (prev.includes(t) ? prev.filter(x => x !== t) : TAG_ORDER.filter(x => x === t || prev.includes(x))))

  return (
    <div className="wbc">
      <style>{CSS}</style>
      <div className="wbc-controls">
        <div className="wbc-wrap">
          <div className="wbc-row wbc-top">
            <img className="wbc-brand" src="/webrand-casting-logo.png" alt="WeBrand" />
            <div className="wbc-row wbc-scroll" role="group" aria-label="Категория">
              {CASTING_TABS.map(t => (t.key === 'all' || counts[t.key] > 0) && (
                <button key={t.key} type="button" className="wbc-tab" aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label} <em>{counts[t.key]}</em>
                </button>
              ))}
            </div>
          </div>
          <div className="wbc-row">
            <div className="wbc-row wbc-scroll" role="group" aria-label="Опыт">
              {TAG_ORDER.map(k => (
                <button key={k} type="button" className="wbc-chip" aria-pressed={tags.includes(k)} onClick={() => toggleTag(k)}>
                  {TAG_LABEL[k]}
                </button>
              ))}
            </div>
            <label className="wbc-search">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
              </svg>
              <input type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Поиск по имени" aria-label="Поиск по имени" />
            </label>
          </div>
        </div>
      </div>

      <main>
        <div className="wbc-wrap wbc-main">
          {isLoading ? (
            <div className="wbc-grid" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="wbc-card wbc-skel"><div className="wbc-ph" /><div className="wbc-body"><span /><span /></div></div>
              ))}
            </div>
          ) : isError ? (
            <p className="wbc-empty">Каталог сейчас недоступен. Обновите страницу чуть позже.</p>
          ) : (
            <>
              <p className="wbc-count wbc-label" aria-live="polite">Найдено: {list.length}</p>
              {list.length === 0 ? (
                <p className="wbc-empty">{all.length ? 'Никого не нашли. Снимите фильтр опыта или измените поиск.' : 'Каталог скоро наполнится.'}</p>
              ) : (
                <div className="wbc-grid">
                  {list.map(p => <Card key={p.id} p={p} onOpen={() => openTalent(p.id)} />)}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {open && <Detail key={open.id} p={open} onClose={close} contact={contact} setContact={setContact} />}
    </div>
  )
}

/** Второе фото на карточке — только там, где есть наведение: на телефоне
 *  его не видно, и качать его незачем. */
const CAN_HOVER = typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(hover: hover)').matches

function Card({ p, onOpen }: { p: PublicTalent; onOpen: () => void }) {
  const [a, b] = splitName(p.name)
  const tags = orderedTags(p.tags)
  const img = photoUrl(p.photos[0])
  const alt = CAN_HOVER ? photoUrl(p.photos[1]) : null
  return (
    <button className="wbc-card" type="button" aria-label={p.name} onClick={onOpen}>
      <div className="wbc-ph">
        {img && <img src={img} alt="" loading="lazy" decoding="async" />}
        {alt && <img className="wbc-alt" src={alt} alt="" loading="lazy" decoding="async" />}
        {p.categories.length > 0 && <span className="wbc-badge">{categoriesText(p.categories, p.kid)}</span>}
        <div className="wbc-meta">
          {p.height && <span><small>Рост</small>{heightText(p.height)}</span>}
          {p.age != null && <span><small>Возраст</small>{ageText(p.age)}</span>}
        </div>
      </div>
      <div className="wbc-body">
        <h3 className="wbc-name">{a}{b && <small>{b}</small>}</h3>
        {tags.length > 0 && (
          <div className="wbc-tags">{tags.map(t => <span key={t} className="wbc-tag">{TAG_LABEL[t]}</span>)}</div>
        )}
      </div>
    </button>
  )
}

function Detail({ p, onClose, contact, setContact }: {
  p: PublicTalent; onClose: () => void; contact: Contact; setContact: (c: Contact) => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [cur, setCur] = useState(0)
  const startX = useRef<number | null>(null)
  const photos = p.photos.map(s => photoUrl(s)).filter((s): s is string => !!s)
  const n = photos.length
  const tags = orderedTags(p.tags)
  const links = linkItems(p.links)
  const cats = categoriesText(p.categories)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const d = ref.current
    if (!d) return
    try { if (!d.open) d.showModal() } catch { d.setAttribute('open', '') }
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    // Escape: браузер закрывает окно сам — состояние догоняем по cancel.
    const onCancel = (e: Event) => { e.preventDefault(); closeRef.current() }
    d.addEventListener('cancel', onCancel)
    return () => {
      d.removeEventListener('cancel', onCancel)
      html.style.overflow = prev
      try { if (d.open) d.close() } catch { /* уже закрыто */ }
    }
  }, [])

  const go = (dlt: number) => n > 1 && setCur(i => (i + dlt + n) % n)

  return (
    <dialog ref={ref} className="wbc-dlg" aria-labelledby="wbc-dlg-name"
      onClick={e => { if (e.target === ref.current) onClose() }}>
      <div className="wbc-sheet">
        <div className="wbc-bar"><button className="wbc-x" type="button" aria-label="Закрыть" onClick={onClose}>×</button></div>
        <div className="wbc-gal">
          <div className="wbc-big"
            onTouchStart={e => { startX.current = e.touches[0].clientX }}
            onTouchEnd={e => {
              if (startX.current == null) return
              const dx = e.changedTouches[0].clientX - startX.current
              startX.current = null
              if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
            }}>
            {n > 0 && <img src={photos[cur]} alt={`${p.name}, фото ${cur + 1}`} />}
          </div>
          {n > 1 && (
            <div className="wbc-thumbs">
              {photos.map((s, i) => (
                <button key={s + i} className="wbc-thumb" type="button" aria-label={`Фото ${i + 1}`} aria-current={i === cur} onClick={() => setCur(i)}>
                  <img src={s} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="wbc-info">
          <button className="wbc-x wbc-x-desk" type="button" aria-label="Закрыть" onClick={onClose}>×</button>
          <span className="wbc-label wbc-lime">{cats}{p.kid ? `${cats ? ' · ' : ''}Дети` : ''}</span>
          <h2 id="wbc-dlg-name">{p.name}</h2>
          <div className="wbc-facts">
            <div><span className="wbc-label">Рост</span><b>{heightText(p.height) || '—'}</b></div>
            <div><span className="wbc-label">Возраст</span><b>{ageText(p.age) || '—'}</b></div>
            <div className="wbc-wide"><span className="wbc-label">Город</span><b className="wbc-city">{p.city || '—'}</b></div>
          </div>
          {tags.length > 0 && (
            <div className="wbc-tags">{tags.map(t => <span key={t} className="wbc-tag">{TAG_LABEL[t]}</span>)}</div>
          )}
          {p.experience?.trim() && (
            <div><span className="wbc-label">Опыт</span><p className="wbc-exp">{p.experience}</p></div>
          )}
          {links.length > 0 && (
            <div className="wbc-links">
              {links.map(l => <a key={l.href} href={l.href} target="_blank" rel="noopener noreferrer">{l.label} ↗</a>)}
            </div>
          )}
          <Booking p={p} contact={contact} setContact={setContact} />
        </div>
      </div>
    </dialog>
  )
}

function Booking({ p, contact, setContact }: { p: PublicTalent; contact: Contact; setContact: (c: Contact) => void }) {
  const [state, setState] = useState<'idle' | 'form' | 'sending' | 'sent'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [website, setWebsite] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (state === 'form') nameRef.current?.focus({ preventScroll: false }) }, [state])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const err = bookingError(contact)
    if (err) { setError(err); return }
    setError(null)
    setState('sending')
    try {
      await publicCastingApi.book({
        talentIds: [p.id],
        name: contact.name.trim(),
        phone: contact.phone.trim(),
        comment: contact.comment.trim() || undefined,
        website: website || undefined,
      })
      setContact({ ...contact, comment: '' })
      setState('sent')
    } catch (ex: any) {
      const status = ex?.response?.status
      const msg = ex?.response?.data?.message
      setError(status === 429
        ? 'Слишком много заявок подряд. Попробуйте через минуту.'
        : status === 400 && typeof msg === 'string' && msg
          ? msg
          : 'Не удалось отправить. Проверьте интернет и попробуйте ещё раз.')
      setState('form')
    }
  }

  if (state === 'sent') {
    return (
      <div className="wbc-book" role="status">
        <p className="wbc-done">Заявка отправлена — мы свяжемся</p>
        <small>Менеджер WeBrand позвонит по номеру {contact.phone.trim()}.</small>
      </div>
    )
  }
  if (state === 'idle') {
    return (
      <div className="wbc-book">
        <p>Хотите этого актёра в свой проект?</p>
        <button type="button" className="wbc-cta" onClick={() => setState('form')}>Забронировать {ARROW}</button>
        <small>Съёмка под ключ от WeBrand</small>
      </div>
    )
  }
  const sending = state === 'sending'
  return (
    <form className="wbc-book" onSubmit={submit} noValidate>
      <p>Заявка: {p.name}</p>
      <label className="wbc-field">
        <span>Ваше имя</span>
        <input ref={nameRef} value={contact.name} onChange={e => setContact({ ...contact, name: e.target.value })}
          autoComplete="name" maxLength={100} required />
      </label>
      <label className="wbc-field">
        <span>Телефон</span>
        <input type="tel" inputMode="tel" value={contact.phone} onChange={e => setContact({ ...contact, phone: e.target.value })}
          autoComplete="tel" placeholder="+992" maxLength={40} required />
      </label>
      <label className="wbc-field">
        <span>Комментарий</span>
        <textarea rows={3} value={contact.comment} onChange={e => setContact({ ...contact, comment: e.target.value })}
          placeholder="Проект, даты съёмки — по желанию" maxLength={1000} />
      </label>
      {/* Ловушка для ботов: человек это поле не видит. */}
      <input className="wbc-hp" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true"
        value={website} onChange={e => setWebsite(e.target.value)} />
      {error && <p className="wbc-err" role="alert">{error}</p>}
      <div className="wbc-actions">
        <button type="submit" className="wbc-cta" disabled={sending}>{sending ? 'Отправляем…' : 'Отправить заявку'} {!sending && ARROW}</button>
        <button type="button" className="wbc-ghost" disabled={sending} onClick={() => { setError(null); setState('idle') }}>Отмена</button>
      </div>
    </form>
  )
}

// Макет артефакта «WeBrand Casting» — цвета, шрифты и точки перелома
// (820 и 520 px) те же. Добавлено: полноэкранная карточка на телефоне,
// пальцевые размеры кнопок (≥ 44 px) и форма заявки в синем блоке.
const CSS = `
.wbc{--ink:#0B0D12;--ink-2:#12151D;--card:#161A23;--line:#252B38;--text:#F4F6FA;--muted:#9AA3B5;
  --brand:#2B5ED3;--brand-2:#4A80F5;--lime:#C8F135;--lime-ink:#1A2300;
  --display:'Unbounded','Manrope',Arial,sans-serif;--body:'Manrope',Arial,sans-serif;--mono:'JetBrains Mono',ui-monospace,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
  min-height:100vh;min-height:100dvh;background:var(--ink);color:var(--text);font-family:var(--body);font-size:15px;line-height:1.5;
  color-scheme:dark;-webkit-font-smoothing:antialiased;overflow-x:clip}
.wbc *,.wbc *::before,.wbc *::after{box-sizing:border-box}
.wbc a{color:inherit}
.wbc button{font:inherit;color:inherit}
.wbc-wrap{max-width:1240px;margin:0 auto;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.wbc-label{font-family:var(--mono);font-size:12px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.wbc-lime{color:var(--lime)}

.wbc-controls{position:sticky;top:0;z-index:5;background:rgba(11,13,18,.88);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--line);padding-top:env(safe-area-inset-top,0px)}
.wbc-controls .wbc-wrap{padding-top:16px;padding-bottom:16px;display:flex;flex-direction:column;gap:12px}
.wbc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;min-width:0}
.wbc-brand{height:26px;width:auto;margin-right:12px;display:block}
.wbc-tab{font:700 13px var(--mono);letter-spacing:.03em;text-transform:uppercase;border:1px solid var(--line);background:transparent;color:var(--text);padding:9px 14px;border-radius:999px;cursor:pointer;display:inline-flex;gap:8px;align-items:center;flex:none;transition:background .2s var(--ease),border-color .2s var(--ease)}
.wbc-tab em{font-style:normal;color:var(--muted)}
.wbc-tab:hover{border-color:var(--muted)}
.wbc-tab[aria-pressed="true"]{background:var(--lime);color:var(--ink);border-color:var(--lime)}
.wbc-tab[aria-pressed="true"] em{color:var(--lime-ink)}
.wbc-chip{font:600 13px var(--body);border:1px dashed var(--line);background:transparent;color:var(--muted);padding:7px 12px;border-radius:999px;cursor:pointer;flex:none}
.wbc-chip[aria-pressed="true"]{border-style:solid;border-color:var(--brand-2);color:var(--text);background:rgba(43,94,211,.18)}
.wbc-search{flex:1;min-width:200px;max-width:340px;margin-left:auto;display:flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;padding:0 14px;background:var(--ink-2)}
.wbc-search input{flex:1;min-width:0;background:transparent;border:0;color:var(--text);font:600 16px var(--body);padding:9px 0;outline:none;-webkit-appearance:none;appearance:none}
.wbc-search input::placeholder{color:var(--muted);opacity:1}
.wbc-search svg{width:16px;height:16px;color:var(--muted);flex:none}
.wbc-search:focus-within{border-color:var(--muted)}
.wbc-tab:focus-visible,.wbc-chip:focus-visible,.wbc-card:focus-visible,.wbc-cta:focus-visible,.wbc-x:focus-visible,.wbc-thumb:focus-visible,.wbc-ghost:focus-visible,.wbc-links a:focus-visible{outline:2px solid var(--lime);outline-offset:2px}

.wbc-main{padding-top:22px;padding-bottom:max(48px,env(safe-area-inset-bottom,0px))}
.wbc-count{margin:0 0 16px}
.wbc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px}
.wbc-card{background:var(--card);border:1px solid var(--line);border-radius:20px;overflow:hidden;cursor:pointer;text-align:left;color:inherit;padding:0;font:inherit;display:flex;flex-direction:column;min-width:0;transition:transform .35s var(--ease),border-color .25s}
.wbc-card:hover{transform:translateY(-4px);border-color:#3A4254}
.wbc-ph{position:relative;aspect-ratio:3/4;background:#1E2330;overflow:hidden}
.wbc-ph img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity .45s var(--ease),transform .8s var(--ease)}
.wbc-ph img.wbc-alt{opacity:0}
@media (hover:hover){.wbc-card:hover .wbc-ph img.wbc-alt{opacity:1}.wbc-card:hover .wbc-ph img{transform:scale(1.03)}}
.wbc-ph::after{content:"";position:absolute;inset:auto 0 0 0;height:45%;background:linear-gradient(to top,rgba(11,13,18,.85),rgba(11,13,18,0));pointer-events:none}
.wbc-badge{position:absolute;top:12px;left:12px;right:12px;width:max-content;max-width:calc(100% - 24px);z-index:1;font:700 11px var(--mono);letter-spacing:.05em;text-transform:uppercase;background:var(--lime);color:var(--ink);padding:5px 10px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wbc-meta{position:absolute;left:14px;right:14px;bottom:12px;z-index:1;display:flex;gap:14px;font:700 13px var(--mono);color:#fff}
.wbc-meta span{display:flex;flex-direction:column;line-height:1.1;min-width:0}
.wbc-meta small{font-size:10px;font-weight:500;color:rgba(255,255,255,.65);letter-spacing:.06em;text-transform:uppercase}
.wbc-body{padding:14px 14px 16px;display:flex;flex-direction:column;gap:10px;flex:1}
.wbc-name{font-family:var(--display);font-weight:700;font-size:16px;line-height:1.2;text-transform:uppercase;margin:0;overflow-wrap:anywhere}
.wbc-name small{display:block;font-family:var(--body);font-weight:600;font-size:13px;text-transform:none;color:var(--muted);margin-top:4px}
.wbc-tags{display:flex;gap:5px;flex-wrap:wrap}
.wbc-tag{font:600 12px var(--body);color:var(--muted);background:rgba(255,255,255,.04);border-radius:6px;padding:3px 8px}
.wbc-empty{padding:60px 0;text-align:center;color:var(--muted);margin:0}
.wbc-skel{cursor:default;pointer-events:none}
.wbc-skel .wbc-body span{display:block;height:12px;border-radius:6px;background:#1E2330}
.wbc-skel .wbc-body span+span{width:55%}
.wbc-skel .wbc-ph,.wbc-skel .wbc-body span{animation:wbc-pulse 1.4s ease-in-out infinite}
@keyframes wbc-pulse{50%{opacity:.55}}

.wbc-dlg{border:0;padding:0;background:transparent;max-width:min(1040px,calc(100vw - 24px));width:100%;color:var(--text);font-family:var(--body);font-size:15px;line-height:1.5;color-scheme:dark}
.wbc-dlg::backdrop{background:rgba(5,6,9,.78);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.wbc-sheet{background:var(--ink-2);border:1px solid var(--line);border-radius:26px;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);max-height:calc(100dvh - 40px)}
.wbc-bar{display:none}
.wbc-gal{background:#000;display:flex;flex-direction:column;min-height:0}
.wbc-big{flex:1;min-height:0;position:relative;aspect-ratio:3/4;touch-action:pan-y}
.wbc-big img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.wbc-thumbs{display:flex;gap:6px;padding:8px;background:var(--ink-2);overflow-x:auto;scrollbar-width:none}
.wbc-thumbs::-webkit-scrollbar{display:none}
.wbc-thumb{flex:1 0 48px;aspect-ratio:1;border:2px solid transparent;border-radius:10px;overflow:hidden;padding:0;cursor:pointer;background:none;max-width:80px;min-width:48px}
.wbc-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.wbc-thumb[aria-current="true"]{border-color:var(--lime)}
.wbc-info{padding:28px;display:flex;flex-direction:column;gap:18px;overflow:auto;position:relative;min-width:0}
.wbc-x{width:44px;height:44px;border-radius:50%;border:1px solid var(--line);background:var(--card);color:var(--text);font-size:22px;line-height:1;cursor:pointer;display:grid;place-items:center}
.wbc-x-desk{position:absolute;top:16px;right:16px}
.wbc-info h2{font-family:var(--display);font-weight:800;font-size:clamp(24px,3vw,34px);line-height:1.05;text-transform:uppercase;margin:0;padding-right:52px;overflow-wrap:anywhere}
.wbc-facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.wbc-facts div{background:var(--card);padding:12px 14px;display:flex;flex-direction:column;gap:2px;min-width:0}
.wbc-facts .wbc-wide{grid-column:1/-1}
.wbc-facts b{font-family:var(--display);font-weight:700;font-size:20px;overflow-wrap:anywhere}
.wbc-facts b.wbc-city{font-size:16px}
.wbc-exp{margin:0;color:#D5DAE5;font-size:15px;max-width:60ch;white-space:pre-line;overflow-wrap:anywhere}
.wbc-links{display:flex;gap:8px;flex-wrap:wrap}
.wbc-links a{font:700 12px var(--mono);text-transform:uppercase;letter-spacing:.04em;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:0 14px;min-height:44px;display:inline-flex;align-items:center}
.wbc-links a:hover{border-color:var(--brand-2)}

.wbc-book{margin-top:auto;background:var(--brand);border-radius:18px;padding:18px;display:flex;flex-direction:column;gap:12px}
.wbc-book p{margin:0;font-weight:700}
.wbc-book small{color:#DCE6FF;font-family:var(--mono);font-size:12px}
.wbc-book .wbc-done{font-family:var(--display);font-size:18px;text-transform:uppercase;line-height:1.2}
.wbc-cta{display:inline-flex;align-items:center;justify-content:center;gap:12px;align-self:flex-start;background:var(--lime);color:var(--ink);border:0;cursor:pointer;text-decoration:none;font-family:var(--display);font-weight:700;font-size:15px;text-transform:uppercase;padding:14px 22px;min-height:48px;border-radius:999px;transition:transform .2s var(--ease)}
.wbc-cta:hover{transform:translateY(-2px)}
.wbc-cta:disabled{opacity:.7;cursor:default;transform:none}
.wbc-cta svg{width:18px;height:18px}
.wbc-field{display:flex;flex-direction:column;gap:4px}
.wbc-field span{font:500 11px var(--mono);letter-spacing:.06em;text-transform:uppercase;color:#DCE6FF}
.wbc-field input,.wbc-field textarea{width:100%;background:rgba(11,13,18,.32);border:1px solid rgba(255,255,255,.28);border-radius:12px;color:#fff;font:600 16px var(--body);padding:11px 14px;min-height:46px;outline:none;resize:vertical}
.wbc-field input::placeholder,.wbc-field textarea::placeholder{color:rgba(220,230,255,.6)}
.wbc-field input:focus,.wbc-field textarea:focus{border-color:var(--lime)}
.wbc-hp{position:absolute;left:-10000px;width:1px;height:1px;opacity:0}
.wbc-err{margin:0;font-weight:600;font-size:14px;color:#fff;background:rgba(11,13,18,.35);border-radius:10px;padding:8px 12px}
.wbc-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.wbc-ghost{background:transparent;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:999px;min-height:48px;padding:0 18px;font:700 13px var(--mono);text-transform:uppercase;letter-spacing:.04em;cursor:pointer}

@media (max-width:820px){
  .wbc-tab,.wbc-chip{min-height:44px}
  .wbc-search{max-width:none;margin-left:0;min-height:44px;flex-basis:100%}
  .wbc-sheet{display:block;overflow:auto;overscroll-behavior:contain}
  .wbc-bar{display:flex;justify-content:flex-end;position:sticky;top:0;height:0;z-index:3;overflow:visible}
  .wbc-bar .wbc-x{margin:12px 12px 0 0;background:rgba(22,26,35,.82);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}
  .wbc-x-desk{display:none}
  .wbc-gal .wbc-big{aspect-ratio:4/5;flex:none;width:100%}
  .wbc-info{overflow:visible;padding:22px}
  .wbc-info h2{padding-right:0}
  .wbc-facts b{font-size:17px}
}
@media (max-width:520px){
  .wbc-controls{position:static}
  .wbc-controls .wbc-wrap{gap:10px;padding-top:12px;padding-bottom:12px}
  .wbc-top{flex-direction:column;align-items:stretch}
  .wbc-brand{height:22px;margin:0 0 2px}
  .wbc-scroll{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin:0 -16px;padding:0 16px;scroll-padding:0 16px}
  .wbc-scroll::-webkit-scrollbar{display:none}
  .wbc-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
  .wbc-card{border-radius:16px}
  .wbc-name{font-size:13px}
  .wbc-body{padding:10px}
  .wbc-tags .wbc-tag:nth-child(n+3){display:none}
  .wbc-info .wbc-tags .wbc-tag:nth-child(n+3){display:inline}
  .wbc-meta{gap:10px;font-size:12px;left:10px;right:10px;bottom:10px}
  .wbc-badge{top:8px;left:8px;max-width:calc(100% - 16px);font-size:10px;padding:4px 8px}
  .wbc-dlg{max-width:100vw;width:100vw;height:100vh;height:100dvh;max-height:none;margin:0}
  .wbc-sheet{border-radius:0;border:0;height:100%;max-height:none}
  .wbc-bar .wbc-x{margin-top:max(12px,env(safe-area-inset-top,0px))}
  .wbc-info{padding:20px 16px max(24px,env(safe-area-inset-bottom,0px))}
  .wbc-cta{align-self:stretch}
  .wbc-actions .wbc-cta{flex:1}
}
@media (prefers-reduced-motion:reduce){.wbc *{transition:none!important;animation:none!important}}
`
