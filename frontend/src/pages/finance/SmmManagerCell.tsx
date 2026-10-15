// Колонка «Менеджер» в «Доход → SMM» (макет владельца 13.10.2026): кто берёт
// деньги у клиента. Это ответственный менеджер SMM-проекта из CRM — отдельного
// поля в «Финансах» нет, поэтому назначение здесь и в карточке проекта всегда
// одно и то же. Клиент, которого нет среди SMM-проектов CRM, связывается с
// проектом здесь же.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import FinIcon from './FinIcon';
import { apiErr } from './finlib';
import { projectsApi, smmPaymentsApi, type FinanceManagers, type FinancePerson } from '@/services/api.service';
import { useAuthStore } from '@/store/auth.store';

const KEY = ['finance', 'smm-managers'] as const;
/** Кому сервер отдаёт менеджеров. Остальным запрос не шлём: он вернул бы
 *  отказ и запись в журнале безопасности. */
const TOP_ROLES = ['founder', 'admin'];
/** С какого числа проектов в списке «связать» появляется строка поиска. */
const SEARCH_FROM = 8;

export function useSmmManagers(enabled = true) {
  const user = useAuthStore((s) => s.user);
  const allowed = [user?.role, (user as any)?.secondaryRole].some((r) => !!r && TOP_ROLES.includes(r));
  const { data } = useQuery({ queryKey: KEY, queryFn: () => smmPaymentsApi.financeManagers(), enabled: enabled && allowed, staleTime: 60_000 });
  return data ?? null;
}

const API = import.meta.env.VITE_API_URL || '';
/** Ссылка на фото сотрудника — по тому же правилу, что общий Avatar: в базе
 *  лежит не адрес, а имя файла или «db:<id>», а сервер живёт на другом домене.
 *  Без этого вместо фото был значок битой картинки. */
export function avatarUrl(src: string): string {
  if (src.startsWith('http')) return src;
  return src.startsWith('db:') ? `${API}/api/avatars/${src.slice(3)}` : `${API}/uploads/avatars/${src}`;
}

const AVATAR_COLORS = ['#7a5a2e', '#3f5f80', '#4f6f52', '#6b4f7a', '#7a4f4f', '#3f6f72'];
function Avatar({ person, size }: { person: FinancePerson; size: number }) {
  // Фото не загрузилось — показываем букву, а не пустой кружок.
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [person.avatar]);
  if (person.avatar && !failed) {
    return (
      <img src={avatarUrl(person.avatar)} alt="" width={size} height={size} loading="lazy" className="fin-mgr-avatar"
        style={{ width: size, height: size }} onError={() => setFailed(true)} />
    );
  }
  let hash = 0;
  for (const ch of person.name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return (
    <span className="fin-mgr-avatar" aria-hidden="true"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), background: AVATAR_COLORS[hash % AVATAR_COLORS.length] }}>
      {person.name.trim().charAt(0).toUpperCase()}
    </span>
  );
}

const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/i).filter(Boolean);
/** Проекты для «связать»: свободные и похожие по названию — первыми. Клиент
 *  «Остиум Умрона» скорее всего и есть проект «Остиум»: пусть он стоит сверху,
 *  а не теряется в списке по алфавиту. */
export function rankProjects<T extends { name: string; taken: boolean }>(clientName: string, projects: T[]): T[] {
  const mine = new Set(words(clientName));
  const score = (p: T) => words(p.name).filter((w) => mine.has(w)).length;
  return [...projects].sort((a, b) =>
    Number(a.taken) - Number(b.taken) || score(b) - score(a) || a.name.localeCompare(b.name, 'ru'));
}

type Pos = { left: number; top?: number; bottom?: number; maxH: number };

export default function SmmManagerCell({ financeProjectId, clientName, data, narrow, bordered }: {
  financeProjectId: string;
  /** Название клиента в «Финансах» — чтобы похожие проекты CRM стояли первыми. */
  clientName?: string;
  data: FinanceManagers | null;
  /** Телефон: список открывается снизу экрана. */
  narrow?: boolean;
  /** Карточка на телефоне: у менеджера видна рамка. */
  bordered?: boolean;
}) {
  const qc = useQueryClient();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<'manager' | 'link' | null>(null);
  const [pos, setPos] = useState<Pos | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  // Список привязан к своей кнопке: открывается под ней, а если места снизу
  // мало — над ней; высота — по свободному месту, дальше он листается сам.
  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Кнопка ушла за край экрана — список больше не к чему привязывать.
    if (r.bottom < 0 || r.top > window.innerHeight) { setMenu(null); return; }
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const up = below < 220 && above > below;
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - 288)),
      top: up ? undefined : r.bottom + 6,
      bottom: up ? window.innerHeight - r.top + 6 : undefined,
      maxH: Math.max(140, Math.min(360, up ? above : below)),
    });
  }, []);

  useEffect(() => {
    if (!menu) return;
    place();
    // Страница листается — список едет за своей кнопкой. Прокрутка самого
    // списка сюда не относится: раньше она его закрывала, и длинный список
    // проектов нельзя было пролистать (замечание владельца 13.10.2026).
    const onScroll = (e: Event) => {
      if (menuRef.current && e.target instanceof Node && menuRef.current.contains(e.target)) return;
      place();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu, place]);

  const row = data?.clients.find((c) => c.financeProjectId === financeProjectId) ?? null;
  if (!data || !row) return <span className="muted">—</span>;

  const open = (kind: 'manager' | 'link') => { setQ(''); setPos(null); setMenu(kind); };

  // Менеджер проекта: меняем кэш сразу, сервер догоняет.
  async function assign(manager: FinancePerson | null) {
    if (!row?.project || busy) return;
    setMenu(null);
    const prev = qc.getQueryData<FinanceManagers>(KEY);
    qc.setQueryData<FinanceManagers>(KEY, (old) => old && {
      ...old,
      clients: old.clients.map((c) => (c.financeProjectId === financeProjectId ? { ...c, manager } : c)),
    });
    setBusy(true);
    try {
      await projectsApi.setSmmManager(row.project.id, manager?.id ?? null);
      qc.invalidateQueries({ queryKey: KEY });
    } catch (e) {
      qc.setQueryData(KEY, prev);
      toast.error(apiErr(e));
    } finally { setBusy(false); }
  }
  async function link(projectId: string) {
    if (busy) return;
    setMenu(null);
    setBusy(true);
    try {
      qc.setQueryData(KEY, await smmPaymentsApi.linkClient(financeProjectId, projectId));
    } catch (e) { toast.error(apiErr(e)); } finally { setBusy(false); }
  }

  let trigger;
  if (!row.project) {
    trigger = data.canLink
      ? <button ref={btnRef} type="button" className="fin-mgr-ghost warn" onClick={() => open('link')}>нет в CRM — связать</button>
      : <span className="mini" style={{ color: 'var(--amber)' }}>нет в CRM</span>;
  } else if (!row.manager) {
    trigger = data.canAssign
      ? <button ref={btnRef} type="button" className="fin-mgr-ghost" onClick={() => open('manager')}>Назначить</button>
      : <span className="mini muted">не назначен</span>;
  } else if (data.canAssign) {
    trigger = (
      <button ref={btnRef} type="button" aria-expanded={menu === 'manager'}
        className={'fin-mgr' + (bordered ? ' bordered' : '') + (menu ? ' open' : '')}
        title={`${row.manager.name} · проект в CRM: ${row.project.name}`} onClick={() => open('manager')}>
        <Avatar person={row.manager} size={24} />
        <span className="name">{row.manager.name}</span>
        {/* В наборе значков «Финансов» стрелки вниз нет — поворачиваем правую. */}
        <FinIcon name="chevronRight" size={12} className="chev" style={{ transform: 'rotate(90deg)' }} />
      </button>
    );
  } else {
    trigger = (
      <span className={'fin-mgr static' + (bordered ? ' bordered' : '')} title={`${row.manager.name} · проект в CRM: ${row.project.name}`}>
        <Avatar person={row.manager} size={24} />
        <span className="name">{row.manager.name}</span>
      </span>
    );
  }

  const ranked = menu === 'link' ? rankProjects(clientName || '', data.projects) : [];
  const needle = q.trim().toLowerCase();
  const shown = needle ? ranked.filter((p) => p.name.toLowerCase().includes(needle)) : ranked;

  return (
    <>
      {trigger}
      {menu && (narrow || pos) && (
        <>
          <div className={'fin-mgr-backdrop' + (narrow ? ' sheet' : '')} onClick={() => setMenu(null)} />
          <div ref={menuRef} role="menu" className={'fin-mgr-menu' + (narrow ? ' sheet' : '')}
            style={narrow || !pos ? undefined : { left: pos.left, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxH }}>
            {menu === 'manager' ? (
              <>
                <div className="mgr-head">Менеджеры по продажам</div>
                {!data.managers.length && <p className="mgr-empty">Менеджеров по продажам нет</p>}
                {data.managers.map((m) => (
                  <button key={m.id} type="button" role="menuitem" className="mgr-item"
                    onClick={() => (row.manager?.id === m.id ? setMenu(null) : assign(m))}>
                    <Avatar person={m} size={26} />
                    <span className="name">{m.name}</span>
                    {row.manager?.id === m.id && <FinIcon name="check" size={15} style={{ color: 'var(--green)' }} />}
                  </button>
                ))}
                {row.manager && (
                  <>
                    <div className="mgr-sep" />
                    <button type="button" role="menuitem" className="mgr-item quiet" onClick={() => assign(null)}>Снять менеджера</button>
                  </>
                )}
              </>
            ) : (
              <>
                {/* Заголовок и поиск остаются на месте, пока список листается. */}
                <div className="mgr-top">
                  <div className="mgr-head">SMM-проекты в CRM</div>
                  {ranked.length >= SEARCH_FROM && (
                    <div className="mgr-search">
                      <input autoFocus={!narrow} value={q} onChange={(e) => setQ(e.target.value)}
                        placeholder="Найти проект" aria-label="Найти проект" />
                    </div>
                  )}
                </div>
                {!ranked.length && <p className="mgr-empty">В CRM нет SMM-проектов</p>}
                {ranked.length > 0 && !shown.length && <p className="mgr-empty">Ничего не найдено</p>}
                {shown.map((p) => (
                  <button key={p.id} type="button" role="menuitem" className="mgr-item" onClick={() => link(p.id)}>
                    <span className="name">{p.name}</span>
                    {p.taken && <span className="mini muted">уже связан</span>}
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
