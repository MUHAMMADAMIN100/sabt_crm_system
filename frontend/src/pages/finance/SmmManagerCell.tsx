// Колонка «Менеджер» в «Доход → SMM» (макет владельца 13.10.2026): кто берёт
// деньги у клиента. Это ответственный менеджер SMM-проекта из CRM — отдельного
// поля в «Финансах» нет, поэтому назначение здесь и в карточке проекта всегда
// одно и то же. Клиент, которого нет среди SMM-проектов CRM, связывается с
// проектом здесь же.
import { useEffect, useRef, useState } from 'react';
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

export function useSmmManagers(enabled = true) {
  const user = useAuthStore((s) => s.user);
  const allowed = [user?.role, (user as any)?.secondaryRole].some((r) => !!r && TOP_ROLES.includes(r));
  const { data } = useQuery({ queryKey: KEY, queryFn: () => smmPaymentsApi.financeManagers(), enabled: enabled && allowed, staleTime: 60_000 });
  return data ?? null;
}

const AVATAR_COLORS = ['#7a5a2e', '#3f5f80', '#4f6f52', '#6b4f7a', '#7a4f4f', '#3f6f72'];
function Avatar({ person, size }: { person: FinancePerson; size: number }) {
  if (person.avatar) {
    return <img src={person.avatar} alt="" width={size} height={size} className="fin-mgr-avatar" style={{ width: size, height: size }} />;
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

type Menu = { kind: 'manager' | 'link'; top: number; left: number } | null;

export default function SmmManagerCell({ financeProjectId, data, narrow, bordered }: {
  financeProjectId: string;
  data: FinanceManagers | null;
  /** Телефон: список открывается снизу экрана. */
  narrow?: boolean;
  /** Карточка на телефоне: у менеджера видна рамка. */
  bordered?: boolean;
}) {
  const qc = useQueryClient();
  const btnRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [busy, setBusy] = useState(false);

  // Список висит на месте, а страница листается — закрываем, чтобы он не
  // остался далеко от своей строки.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  const row = data?.clients.find((c) => c.financeProjectId === financeProjectId) ?? null;
  if (!data || !row) return <span className="muted">—</span>;

  const open = (kind: 'manager' | 'link') => {
    const r = btnRef.current?.getBoundingClientRect();
    const left = r ? Math.max(8, Math.min(r.left, window.innerWidth - 288)) : 8;
    setMenu({ kind, top: r ? r.bottom + 6 : 0, left });
  };

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
      <button ref={btnRef} type="button" aria-expanded={menu?.kind === 'manager'}
        className={'fin-mgr' + (bordered ? ' bordered' : '') + (menu ? ' open' : '')}
        title={`Проект в CRM: ${row.project.name}`} onClick={() => open('manager')}>
        <Avatar person={row.manager} size={24} />
        <span className="name">{row.manager.name}</span>
        {/* В наборе значков «Финансов» стрелки вниз нет — поворачиваем правую. */}
        <FinIcon name="chevronRight" size={12} className="chev" style={{ transform: 'rotate(90deg)' }} />
      </button>
    );
  } else {
    trigger = (
      <span className={'fin-mgr static' + (bordered ? ' bordered' : '')} title={`Проект в CRM: ${row.project.name}`}>
        <Avatar person={row.manager} size={24} />
        <span className="name">{row.manager.name}</span>
      </span>
    );
  }

  return (
    <>
      {trigger}
      {menu && (
        <>
          <div className={'fin-mgr-backdrop' + (narrow ? ' sheet' : '')} onClick={() => setMenu(null)} />
          <div role="menu" className={'fin-mgr-menu' + (narrow ? ' sheet' : '')}
            style={narrow ? undefined : { top: menu.top, left: menu.left }}>
            {menu.kind === 'manager' ? (
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
                <div className="mgr-head">SMM-проекты в CRM</div>
                {!data.projects.length && <p className="mgr-empty">В CRM нет SMM-проектов</p>}
                {data.projects.map((p) => (
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
