import { describe, it, expect } from 'vitest'
import {
  canAccessRoute, hasPermission, userCan, canSeeSmmSection, canSeeDevSection, isSmmViewOnly, isProductionOnly, hasAnyRole,
  canSeeSalesAnalytics, canEditSalesNorms, canEditSalesCommission, canLinkHandoff, canCreateHandoffProject,
  canSeeCasting, canEditCasting, canImportCasting, canBookCasting,
} from './permissions'
import type { UserRole } from '@/store/auth.store'

// «Задачи от руководителя»: /tasks и /tasks/:id — раньше маршрутов не было
// вовсе, RoleGuard ссылку тестировать было не на чем. Теперь маршруты
// существуют, и permission 'tasks.view' должен пускать КАЖДУЮ роль.
describe('canAccessRoute — /tasks (раздел «Задачи от руководителя»)', () => {
  const ALL_ROLES: UserRole[] = [
    'admin', 'founder', 'smm_director', 'smm_specialist', 'designer', 'sales_manager_smm', 'sales_manager_dev',
    'pm_dev', 'developer', 'videographer', 'video_editor', 'targetologist', 'employee',
  ]

  it.each(ALL_ROLES)('role "%s" has the tasks.view permission (RoleGuard must not block /tasks)', (role) => {
    expect(hasPermission(role, 'tasks.view')).toBe(true)
  })

  it.each(ALL_ROLES)('role "%s" can access /tasks', (role) => {
    expect(canAccessRoute(role, '/tasks')).toBe(true)
  })

  it.each(ALL_ROLES)('role "%s" can access /tasks/:id (detail page reached from notifications)', (role) => {
    expect(canAccessRoute(role, '/tasks/11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it('unauthenticated (no role) is denied /tasks', () => {
    expect(canAccessRoute(undefined, '/tasks')).toBe(false)
  })
})

// Персональные запреты (deniedPermissions) — снимают право, которое есть по
// роли. Правило обязано совпадать с backend hasGrant: запрет > роль > грант.
describe('userCan — персональные запреты', () => {
  const designer = { role: 'designer' as UserRole, secondaryRole: null }

  it('право роли действует, пока его не отняли', () => {
    expect(userCan({ ...designer }, 'reports.view')).toBe(true)
  })

  it('запрет снимает право, которое даёт роль', () => {
    expect(userCan({ ...designer, deniedPermissions: ['reports.view'] }, 'reports.view')).toBe(false)
  })

  it('запрет снимает и персонально выданный грант', () => {
    const u = { ...designer, extraPermissions: ['clients.view'], deniedPermissions: ['clients.view'] }
    expect(userCan(u, 'clients.view')).toBe(false)
  })

  it('выданный грант работает, пока не запрещён', () => {
    expect(userCan({ ...designer, extraPermissions: ['clients.view'] }, 'clients.view')).toBe(true)
  })

  it('запрет одного ключа не задевает соседние', () => {
    const u = { ...designer, deniedPermissions: ['reports.view'] }
    expect(userCan(u, 'reports.view')).toBe(false)
    expect(userCan(u, 'tasks.view')).toBe(true)
  })

  it('запрет перебивает и право второй роли', () => {
    const u = { role: 'designer' as UserRole, secondaryRole: 'smm_director' as UserRole, deniedPermissions: ['analytics.view'] }
    expect(userCan({ ...u, deniedPermissions: [] }, 'analytics.view')).toBe(true)
    expect(userCan(u, 'analytics.view')).toBe(false)
  })

  // Раньше здесь был /reports — такой страницы в приложении нет, и
  // 15.11.2026 её убрали из PERMISSION_TO_ROUTE. Проверяем на «Файлах».
  it('запрет закрывает и маршрут, а не только пункт меню', () => {
    expect(canAccessRoute('designer', '/files', null, [], [])).toBe(true)
    expect(canAccessRoute('designer', '/files', null, [], ['files.view'])).toBe(false)
  })

  it('запрет закрывает страницу, открытую персональным грантом', () => {
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], [])).toBe(true)
    expect(canAccessRoute('designer', '/clients', null, ['clients.view'], ['clients.view'])).toBe(false)
  })
})

// Раздел «СММ» у менеджеров по продажам (решение владельца 11.10.2026,
// подтверждено 15.10.2026): раздел открыт обоим видам менеджеров, но только
// на просмотр — отмечают они лишь в «Контроле». Сервер держит то же правило
// своими @Roles. Команде разработки раздел закрыт.
describe('раздел «СММ» — менеджеры по продажам', () => {
  const SALES: UserRole[] = ['sales_manager_smm', 'sales_manager_dev']
  const ROUTES = ['/smm', '/smm/stories', '/smm/projects', '/smm/projects/abc', '/smm/control']

  it('оба вида менеджеров открывают все страницы раздела', () => {
    for (const role of SALES) {
      expect(canSeeSmmSection(role)).toBe(true)
      for (const route of ROUTES) expect(canAccessRoute(role, route)).toBe(true)
    }
  })

  it('менеджеры — наблюдатели, СММ-команда и руководство — нет', () => {
    for (const role of SALES) expect(isSmmViewOnly(role)).toBe(true)
    for (const role of ['founder', 'admin', 'smm_director', 'smm_specialist'] as UserRole[]) {
      expect(isSmmViewOnly(role)).toBe(false)
    }
  })

  it('остальным ролям раздел по-прежнему закрыт', () => {
    for (const role of ['designer', 'developer', 'videographer', 'pm_dev'] as UserRole[]) {
      expect(canSeeSmmSection(role)).toBe(false)
      expect(canAccessRoute(role, '/smm')).toBe(false)
    }
  })
})

// «Директ» — переписка Instagram (04.11.2026): доступ как у Базы клиентов.
describe('раздел «Директ»', () => {
  it('менеджеры продаж и руководство — да, остальные — нет', () => {
    for (const role of ['sales_manager_smm', 'sales_manager_dev', 'admin', 'founder'] as UserRole[]) {
      expect(canAccessRoute(role, '/direct')).toBe(true)
    }
    for (const role of ['designer', 'developer', 'smm_specialist', 'producer'] as UserRole[]) {
      expect(canAccessRoute(role, '/direct')).toBe(false)
    }
  })
  it('личный доступ к клиентам открывает, запрет — закрывает', () => {
    expect(canAccessRoute('designer', '/direct', null, ['clients.view'], [])).toBe(true)
    expect(canAccessRoute('sales_manager_smm', '/direct', null, [], ['clients.view'])).toBe(false)
  })
})

// Продюсер (09.11.2026): в разделе «СММ» — права СММ-специалиста по
// производству (съёмки, монтаж, дизайн), ставит задачи; публикации, бриф,
// рекламу и «Контроль» смотрит, сторис не отмечает.
describe('продюсер — производство как у СММ-специалиста', () => {
  it('раздел «СММ» открыт целиком', () => {
    for (const route of ['/smm', '/smm/stories', '/smm/projects', '/smm/projects/x', '/smm/control']) {
      expect(canAccessRoute('producer', route)).toBe(true)
    }
    expect(canSeeSmmSection('producer')).toBe(true)
    expect(isSmmViewOnly('producer')).toBe(false)
  })
  it('правит только производство', () => {
    expect(isProductionOnly('producer')).toBe(true)
    expect(isProductionOnly('videographer', 'producer')).toBe(true)
    expect(isProductionOnly('producer', 'smm_specialist')).toBe(false)
    expect(isProductionOnly('smm_specialist')).toBe(false)
  })
  it('ставит задачи, но не заводит проекты и не отмечает сторис', () => {
    for (const perm of ['tasks.create', 'tasks.edit', 'reports.create'] as const) {
      expect(hasPermission('producer', perm)).toBe(true)
    }
    expect(hasPermission('producer', 'projects.create')).toBe(false)
    expect(hasPermission('producer', 'stories.manage')).toBe(false)
  })
})

// Импликации грантов — ровно как на сервере (15.11.2026): только
// dev-tracker.manage ⇒ dev-tracker.view. clients.create и projects.create/edit
// раньше открывали view-права, которых сервер не давал, — меню показывало
// «Базу клиентов» и «Директ», а все их запросы получали 403.
describe('GRANTABLE_FE — импликации как у бэкенда', () => {
  it('грант clients.create не открывает «Базу клиентов» и «Директ»', () => {
    const u = { role: 'designer' as UserRole, secondaryRole: null, extraPermissions: ['clients.create'] }
    expect(userCan(u, 'clients.view')).toBe(false)
    expect(canAccessRoute('designer', '/clients', null, ['clients.create'], [])).toBe(false)
    expect(canAccessRoute('designer', '/direct', null, ['clients.create'], [])).toBe(false)
  })

  it('гранты projects.create/edit не дают projects.view', () => {
    const u = { role: 'stories_checker' as UserRole, secondaryRole: null, extraPermissions: ['projects.create', 'projects.edit'] }
    expect(userCan(u, 'projects.view')).toBe(false)
  })

  it('dev-tracker.manage по-прежнему открывает доску (view)', () => {
    const u = { role: 'designer' as UserRole, secondaryRole: null, extraPermissions: ['dev-tracker.manage'] }
    expect(userCan(u, 'dev-tracker.view')).toBe(true)
    expect(canAccessRoute('designer', '/dev-board', null, ['dev-tracker.manage'], [])).toBe(true)
    // Запрет view сильнее импликации.
    expect(userCan({ ...u, deniedPermissions: ['dev-tracker.view'] }, 'dev-tracker.view')).toBe(false)
  })
})

// Вторая роль открывает разделы и подстраницы так же, как основная
// (15.11.2026). Выбор кабинета на главной — по-прежнему по основной роли.
describe('разделы и подстраницы — основная ИЛИ вторая роль', () => {
  it('hasAnyRole смотрит на обе роли', () => {
    expect(hasAnyRole('designer', 'admin', ['admin'])).toBe(true)
    expect(hasAnyRole('admin', null, ['admin'])).toBe(true)
    expect(hasAnyRole('designer', null, ['admin'])).toBe(false)
    expect(hasAnyRole(undefined, undefined, ['admin'])).toBe(false)
  })

  it('«Разработка»: МП по разработке со второй ролью «Руководитель разработки»', () => {
    expect(canSeeDevSection('sales_manager_dev')).toBe(false)
    expect(canSeeDevSection('sales_manager_dev', 'dev_director')).toBe(true)
    expect(canAccessRoute('sales_manager_dev', '/dev/projects', 'dev_director')).toBe(true)
    expect(canAccessRoute('sales_manager_dev', '/dev/projects', null)).toBe(false)
  })

  it('«СММ»: дизайнер со второй ролью СММ-специалиста', () => {
    expect(canSeeSmmSection('designer', 'smm_specialist')).toBe(true)
    expect(canAccessRoute('designer', '/smm', 'smm_specialist')).toBe(true)
    expect(canAccessRoute('designer', '/smm', null)).toBe(false)
  })

  it('подстраницы «Сотрудников», «Тест новый» и «Онбординг»', () => {
    expect(canAccessRoute('designer', '/employees/kpi', 'admin')).toBe(true)
    expect(canAccessRoute('designer', '/employees/kpi', null)).toBe(false)
    expect(canAccessRoute('designer', '/employees/sales-plan', 'founder')).toBe(true)
    expect(canAccessRoute('designer', '/test-new', 'admin')).toBe(true)
    expect(canAccessRoute('designer', '/test-new', null)).toBe(false)
    expect(canAccessRoute('designer', '/onboarding', 'sales_manager_smm')).toBe(true)
    expect(canAccessRoute('designer', '/onboarding', null)).toBe(false)
  })
})

// «Проверяющий сторис» с запретом stories.view (15.11.2026): страница
// закрыта, а главная (её всегда можно открыть) не должна вести на неё —
// иначе «/» ↔ «/stories-check» по кругу (см. HomeRoute в App.tsx).
describe('проверяющий сторис с запретом', () => {
  it('без запрета страница открыта, с запретом — закрыта, главная — всегда', () => {
    expect(canAccessRoute('stories_checker', '/stories-check', null, [], [])).toBe(true)
    expect(canAccessRoute('stories_checker', '/stories-check', null, [], ['stories.view'])).toBe(false)
    expect(canAccessRoute('stories_checker', '/', null, [], ['stories.view'])).toBe(true)
  })
})

// Раздел «Продажи» (15.11.2026, docs/SALES_SPEC.md §5): руководство и
// руководители направлений; аналитика и настройки — только руководство,
// комиссия — только основатель. Без правила маршрут открывался бы всем:
// для путей без права canAccessRoute отвечает true.
// 21.11.2026: раздел — только основателю (и «Заявки» руководителям
// направлений); админ его не видит ни в меню, ни по прямой ссылке.
describe('раздел «Продажи» (/sales)', () => {
  it.each(['founder', 'smm_director', 'dev_director'] as UserRole[])('роль «%s» открывает /sales', (role) => {
    expect(canAccessRoute(role, '/sales')).toBe(true)
  })

  it.each(['admin', 'sales_manager_smm', 'sales_manager_dev', 'designer', 'developer', 'employee'] as UserRole[])('роль «%s» — /sales закрыт', (role) => {
    expect(canAccessRoute(role, '/sales')).toBe(false)
    expect(canAccessRoute(role, '/sales/analytics')).toBe(false)
  })

  it('вторая роль руководителя направления тоже открывает раздел — и админу тоже', () => {
    expect(canAccessRoute('sales_manager_dev', '/sales', 'dev_director')).toBe(true)
    expect(canAccessRoute('admin', '/sales', 'smm_director')).toBe(true)
    expect(canSeeSalesAnalytics('admin', 'smm_director')).toBe(false)
  })

  it('аналитика, нормы, комиссия и привязка заявки — только основателю', () => {
    expect(canSeeSalesAnalytics('founder', null)).toBe(true)
    expect(canSeeSalesAnalytics('smm_director', null)).toBe(false)
    expect(canSeeSalesAnalytics('admin', null)).toBe(false)
    expect(canEditSalesNorms('founder', null)).toBe(true)
    expect(canEditSalesNorms('admin', null)).toBe(false)
    expect(canEditSalesCommission('admin', null)).toBe(false)
    expect(canEditSalesCommission('founder', null)).toBe(true)
    expect(canLinkHandoff('dev_director', null)).toBe(false)
    expect(canLinkHandoff('admin', null)).toBe(false)
    expect(canLinkHandoff('founder', null)).toBe(true)
  })

  it('проект по заявке — основатель любой, директор — своего направления', () => {
    expect(canCreateHandoffProject('admin', null, 'smm')).toBe(false)
    expect(canCreateHandoffProject('founder', null, 'smm')).toBe(true)
    expect(canCreateHandoffProject('smm_director', null, 'smm')).toBe(true)
    expect(canCreateHandoffProject('smm_director', null, 'development')).toBe(false)
    expect(canCreateHandoffProject('dev_director', null, 'development')).toBe(true)
    expect(canCreateHandoffProject('sales_manager_smm', null, 'smm')).toBe(false)
  })
})

// «Кастинг» (17.11.2026, docs/CASTING_SPEC.md): видят руководство, руководитель
// SMM, продюсер, SMM-специалисты и видеографы — основной или второй ролью.
// Без правила маршрут открывался бы всем (для путей без права — true).
describe('раздел «Кастинг» (/casting)', () => {
  it.each(['founder', 'admin', 'smm_director', 'producer', 'smm_specialist', 'videographer'] as UserRole[])('роль «%s» открывает /casting и карточку', (role) => {
    expect(canAccessRoute(role, '/casting')).toBe(true)
    expect(canAccessRoute(role, '/casting/11111111-1111-1111-1111-111111111111')).toBe(true)
  })

  it.each(['designer', 'video_editor', 'developer', 'sales_manager_smm', 'targetologist', 'employee'] as UserRole[])('роль «%s» — /casting закрыт', (role) => {
    expect(canAccessRoute(role, '/casting')).toBe(false)
  })

  it('вторая роль тоже открывает раздел', () => {
    expect(canAccessRoute('video_editor', '/casting', 'videographer')).toBe(true)
    expect(canSeeCasting('designer', 'producer')).toBe(true)
  })

  it('правят — руководство, руководитель SMM и продюсер; импорт — без продюсера', () => {
    expect(canEditCasting('producer', null)).toBe(true)
    expect(canEditCasting('smm_specialist', null)).toBe(false)
    expect(canEditCasting('videographer', null)).toBe(false)
    expect(canImportCasting('smm_director', null)).toBe(true)
    expect(canImportCasting('producer', null)).toBe(false)
  })

  it('ставить в съёмку — ещё и SMM-специалист, но не видеограф', () => {
    expect(canBookCasting('smm_specialist', null)).toBe(true)
    expect(canBookCasting('producer', null)).toBe(true)
    expect(canBookCasting('videographer', null)).toBe(false)
  })
})
