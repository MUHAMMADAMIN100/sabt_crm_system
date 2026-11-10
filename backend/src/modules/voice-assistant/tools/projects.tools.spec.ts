import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import {
  archiveProject, createProject, deleteProject, deleteProjectAnnouncement, PROJECTS_TOOLS, projectDetails,
  requestProjectPayment, restoreProject, setDevStage, setProjectCrew, setProjectMembers, updateProject,
} from './projects.tools';
import { NeedChoice, ToolContext, ToolError } from './types';

const ME = '11111111-1111-1111-1111-111111111111';
const FIRUZ = '22222222-2222-2222-2222-222222222222';
const SABRINA = '33333333-3333-3333-3333-333333333333';
const PROJ = '44444444-4444-4444-4444-444444444444';

type Handler = (body?: any, query?: any) => any;

function fakeApi(routes: Record<string, Handler>) {
  const calls: Array<{ method: string; path: string; body?: any; query?: any }> = [];
  const hit = (method: string, path: string, body?: any, query?: any) => {
    calls.push({ method, path, body, query });
    const h = routes[`${method} ${path}`];
    if (!h) throw new ApiError(404, `нет маршрута ${method} ${path}`);
    return Promise.resolve().then(() => h(body, query));
  };
  return {
    calls,
    get: (p: string, q?: any) => hit('GET', p, undefined, q),
    post: (p: string, b?: any) => hit('POST', p, b),
    patch: (p: string, b?: any) => hit('PATCH', p, b),
    delete: (p: string, b?: any) => hit('DELETE', p, b),
    request: (m: string, p: string, b?: any) => hit(m, p, b),
  };
}

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  const refs = new RefTable();
  refs.add('P', PROJ, 'Архидея');
  refs.add('E', FIRUZ, 'Фируз');
  refs.add('E', SABRINA, 'Сабрина');
  return {
    user: {
      id: ME, name: 'Тест', role: 'founder', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api, refs, today: '2026-11-09', nowTime: '10:00', utterance: 'тест',
  };
}

const baseProject = (extra: Record<string, any> = {}) => ({
  id: PROJ, name: 'Архидея', projectType: 'Лендинг', status: 'planning', progress: 20, isArchived: false,
  manager: { id: ME, name: 'Тест', role: 'founder' },
  members: [{ id: ME, name: 'Тест', role: 'founder' }, { id: FIRUZ, name: 'Фируз', role: 'developer' }],
  tasks: [], endDate: '2026-12-01', ...extra,
});

describe('projects.tools', () => {
  it('имена инструментов уникальны', () => {
    const names = PROJECTS_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe('project_details', () => {
    it('показывает деньги только если API их отдал', async () => {
      const withMoney = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject({ paidAmount: 500, totalContractValue: 2000 }) });
      const out1 = await projectDetails.run({ project: 'P1' }, ctxWith(withMoney));
      expect(out1.money).toMatchObject({ paid: 500, contract: 2000 });

      const noMoney = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() });
      const out2 = await projectDetails.run({ project: 'P1' }, ctxWith(noMoney));
      expect(out2.money).toBeUndefined();
      expect(JSON.stringify(out2)).not.toMatch(/clientAccess|briefShareToken/);
    });

    it('неизвестная метка — понятная ошибка', async () => {
      await expect(projectDetails.run({ project: 'P9' }, ctxWith(fakeApi({})))).rejects.toThrow(ToolError);
    });

    it('403 «Not allowed» превращается в русский текст', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => { throw new ApiError(403, 'Not allowed'); } });
      await expect(projectDetails.run({ project: 'P1' }, ctxWith(api))).rejects.toThrow('нет прав');
    });
  });

  describe('create_project', () => {
    it('разработка без вида — просит выбрать', async () => {
      const ctx = ctxWith(fakeApi({}));
      await expect(createProject.preview!({ name: 'Сайт', type: 'dev' }, ctx)).rejects.toBeInstanceOf(NeedChoice);
    });

    it('СММ: как окно сайта — allowNoTariff, smmData, контент-план', async () => {
      const api = fakeApi({
        'POST /projects': () => ({ id: PROJ }),
        'POST /content-plan/smart-generate': () => ({}),
      });
      const out = await createProject.run(
        { name: 'Кофеин', type: 'smm', norm_reels: 12, norm_posts: 8, stories_per_month: 20, cycle_day: 5 }, ctxWith(api),
      );
      expect(api.calls[0].body).toEqual({
        name: 'Кофеин', projectType: 'SMM', allowNoTariff: true,
        smmData: { normReels: 12, normPosts: 8, cycleStartDay: 5, storiesPerMonth: 20, storiesPerDay: 1 },
      });
      expect(api.calls[1]).toMatchObject({ path: '/content-plan/smart-generate', body: { projectId: PROJ, reels: 12, posts: 8 } });
      expect(out.summary).toContain('создан');
    });

    it('разработка: менеджер, срок, клиент и этап 1', async () => {
      const api = fakeApi({
        'POST /projects': () => ({ id: PROJ }),
        [`PATCH /projects/${PROJ}/dev-stage`]: () => ({}),
      });
      await createProject.run(
        { name: 'Клиника', type: 'dev', dev_kind: 'Лендинг', manager: 'E1', end_date: '2026-12-01', client_company: 'Клиника+' },
        ctxWith(api),
      );
      expect(api.calls[0].body).toEqual({
        name: 'Клиника', projectType: 'Лендинг', managerId: FIRUZ, endDate: '2026-12-01',
        startDate: '2026-11-09', clientInfo: { companyName: 'Клиника+' },
      });
      expect(api.calls[1].body).toEqual({ devStage: 1 });
    });

    it('срок в прошлом и мусорные числа отклоняются', async () => {
      const ctx = ctxWith(fakeApi({}));
      await expect(createProject.run({ name: 'X', type: 'design', end_date: '2026-01-01' }, ctx)).rejects.toThrow('прошёл');
      await expect(createProject.run({ name: 'X', type: 'smm', norm_reels: -1 }, ctx)).rejects.toThrow('от 0 до 999');
      await expect(createProject.run({ name: '  ', type: 'design' }, ctx)).rejects.toThrow('название');
    });

    it('всегда с подтверждением', () => {
      expect(createProject.confirm!({ name: 'x', type: 'design' }, ctxWith(fakeApi({})))).toBe(true);
    });
  });

  describe('update_project', () => {
    it('меняет статус и срок, undo возвращает прежнее', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject(), [`PATCH /projects/${PROJ}`]: () => ({}) });
      const out = await updateProject.run({ project: 'P1', status: 'on_hold', end_date: '2026-12-20' }, ctxWith(api));
      expect(api.calls[1].body).toEqual({ status: 'on_hold', endDate: '2026-12-20' });
      expect(out.undo).toEqual([{ method: 'PATCH', path: `/projects/${PROJ}`, body: { status: 'planning', endDate: '2026-12-01' } }]);
    });

    it('назначение чужого менеджера требует подтверждения, себя — нет', () => {
      const ctx = ctxWith(fakeApi({}));
      expect(updateProject.confirm!({ project: 'P1', manager: 'E1' }, ctx)).toBe(true);
      expect(updateProject.confirm!({ project: 'P1', status: 'on_hold' }, ctx)).toBe(false);
    });

    it('архивный проект и «ничего не изменилось»', async () => {
      const arch = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject({ isArchived: true }) });
      await expect(updateProject.run({ project: 'P1', status: 'completed' }, ctxWith(arch))).rejects.toThrow('архиве');
      const same = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() });
      const out = await updateProject.run({ project: 'P1', status: 'planning' }, ctxWith(same));
      expect(out.summary).toContain('менять нечего');
      expect(same.calls.some((c) => c.method === 'PATCH')).toBe(false);
    });

    it('«archived» вручную не выставить', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() });
      await expect(updateProject.run({ project: 'P1', status: 'archived' }, ctxWith(api))).rejects.toThrow('archive_project');
    });

    it('текст ошибки сервера (чек-лист) доходит до человека', async () => {
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => baseProject(),
        [`PATCH /projects/${PROJ}`]: () => { throw new ApiError(403, 'Нельзя перевести проект в работу: не закрыты пункты'); },
      });
      await expect(updateProject.run({ project: 'P1', status: 'in_progress' }, ctxWith(api))).rejects.toThrow('не закрыты пункты');
    });
  });

  describe('set_project_members', () => {
    it('добавляет, отправляя полный список, и умеет откат', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject(), [`PATCH /projects/${PROJ}`]: () => ({}) });
      const out = await setProjectMembers.run({ project: 'P1', add: ['E2'] }, ctxWith(api));
      expect(api.calls[1].body.memberIds.sort()).toEqual([ME, FIRUZ, SABRINA].sort());
      expect(out.undo?.[0].body).toEqual({ memberIds: [ME, FIRUZ] });
    });

    it('менеджера убрать нельзя; уже состоящий — ничего не меняет', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() });
      const ctx = ctxWith(api);
      ctx.refs.add('E', ME, 'Тест');
      await expect(setProjectMembers.run({ project: 'P1', remove: ['E3'] }, ctx)).rejects.toThrow('Менеджера проекта');
      const out = await setProjectMembers.run({ project: 'P1', add: ['E1'] }, ctx);
      expect(out.summary).toContain('уже такой');
    });

    it('пустой запрос и выдуманная метка', async () => {
      const ctx = ctxWith(fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() }));
      await expect(setProjectMembers.run({ project: 'P1' }, ctx)).rejects.toThrow('кого добавить');
      await expect(setProjectMembers.run({ project: 'P1', add: ['E9'] }, ctx)).rejects.toThrow('E9');
    });
  });

  describe('archive / restore / delete', () => {
    it('общий архив: подтверждение и undo с возвратом прежнего статуса', async () => {
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => baseProject({ status: 'on_hold' }),
        [`PATCH /projects/${PROJ}/archive`]: () => ({}),
      });
      const ctx = ctxWith(api);
      expect(archiveProject.confirm!({ project: 'P1' }, ctx)).toBe(true);
      const out = await archiveProject.run({ project: 'P1' }, ctx);
      expect(out.undo).toEqual([
        { method: 'PATCH', path: `/projects/${PROJ}/restore` },
        { method: 'PATCH', path: `/projects/${PROJ}`, body: { status: 'on_hold' } },
      ]);
    });

    it('менеджер продаж: личное скрытие без подтверждения', async () => {
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => baseProject(),
        [`PATCH /projects/${PROJ}/archive`]: () => ({}),
        [`PATCH /projects/${PROJ}/restore`]: () => ({}),
      });
      const ctx = ctxWith(api, { role: 'sales_manager_smm' });
      expect(archiveProject.confirm!({ project: 'P1' }, ctx)).toBe(false);
      const out = await archiveProject.run({ project: 'P1' }, ctx);
      expect(out.summary).toContain('скрыт из вашего списка');
      const back = await restoreProject.run({ project: 'P1' }, ctx);
      expect(back.summary).toContain('в ваш список');
    });

    it('восстановить не архивный — ничего не делает', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject() });
      const out = await restoreProject.run({ project: 'P1' }, ctxWith(api));
      expect(out.summary).toContain('не в архиве');
    });

    it('удаление: подтверждение, без undo, право projects.delete', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject(), [`DELETE /projects/${PROJ}`]: () => ({}) });
      const ctx = ctxWith(api);
      expect(deleteProject.confirm!({ project: 'P1' }, ctx)).toBe(true);
      expect(await deleteProject.preview!({ project: 'P1' }, ctx)).toContain('УДАЛИТЬ ПРОЕКТ');
      const out = await deleteProject.run({ project: 'P1' }, ctx);
      expect(out.undo).toBeUndefined();
      expect(deleteProject.available!({ role: 'founder', deniedPermissions: [] } as any)).toBe(true);
      expect(deleteProject.available!({ role: 'developer', deniedPermissions: [] } as any)).toBe(false);
    });
  });

  describe('set_dev_stage', () => {
    it('двигает этап и откатывает', async () => {
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => baseProject({ devStage: 2 }),
        [`PATCH /projects/${PROJ}/dev-stage`]: () => ({}),
      });
      const out = await setDevStage.run({ project: 'P1', stage: 4 }, ctxWith(api));
      expect(api.calls[1].body).toEqual({ devStage: 4 });
      expect(out.undo?.[0].body).toEqual({ devStage: 2 });
      await expect(setDevStage.run({ project: 'P1', stage: 9 }, ctxWith(api))).rejects.toThrow('от 1 до 6');
    });
  });

  describe('request_project_payment', () => {
    it('без email клиента — отказ ещё в подтверждении', async () => {
      const api = fakeApi({ [`GET /projects/${PROJ}`]: () => baseProject({ clientInfo: {} }) });
      await expect(requestProjectPayment.preview!({ project: 'P1' }, ctxWith(api))).rejects.toThrow('email');
    });

    it('письмо не ушло — честная ошибка, ушло — итог', async () => {
      const bad = fakeApi({ [`POST /projects/${PROJ}/send-payment-request`]: () => ({ sent: false, to: 'a@b.c', remaining: 100 }) });
      await expect(requestProjectPayment.run({ project: 'P1' }, ctxWith(bad))).rejects.toThrow('не отправилось');
      const ok = fakeApi({ [`POST /projects/${PROJ}/send-payment-request`]: () => ({ sent: true, to: 'a@b.c', remaining: 100 }) });
      const out = await requestProjectPayment.run({ project: 'P1', message: 'Добрый день' }, ctxWith(ok));
      expect(ok.calls[0].body).toEqual({ message: 'Добрый день' });
      expect(out.summary).toContain('100');
    });
  });

  describe('объявления', () => {
    it('удаление по метке X с проектом внутри', async () => {
      const api = fakeApi({ [`DELETE /projects/${PROJ}/announcements/ann-1`]: () => ({}) });
      const ctx = ctxWith(api);
      const ref = ctx.refs.add('X', `${PROJ}/ann-1`, 'Съёмка');
      const out = await deleteProjectAnnouncement.run({ announcement: ref }, ctx);
      expect(out.summary).toContain('Съёмка');
      await expect(deleteProjectAnnouncement.run({ announcement: 'X9' }, ctx)).rejects.toThrow(ToolError);
    });
  });

  describe('set_project_crew', () => {
    const smm = (ids: string[]) => baseProject({ projectType: 'SMM', smmData: { videographerIds: ids } });

    it('сервер отбросил человека — честная ошибка', async () => {
      const saved: string[] = [];
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => smm(saved),
        [`PATCH /projects/${PROJ}/smm-profile`]: () => ({}),
      });
      await expect(setProjectCrew.run({ project: 'P1', kind: 'videographer', add: ['E1'] }, ctxWith(api)))
        .rejects.toThrow('нет подходящей роли');
    });

    it('назначает и откатывает', async () => {
      let ids: string[] = [];
      const api = fakeApi({
        [`GET /projects/${PROJ}`]: () => smm(ids),
        [`PATCH /projects/${PROJ}/smm-profile`]: (b) => { ids = b.videographerIds; return {}; },
      });
      const out = await setProjectCrew.run({ project: 'P1', kind: 'videographer', add: ['E1'] }, ctxWith(api));
      expect(out.undo?.[0].body).toEqual({ videographerIds: [] });
    });

    it('СММ-специалист не переставляет специалистов', async () => {
      const ctx = ctxWith(fakeApi({}), { role: 'smm_specialist' });
      await expect(setProjectCrew.run({ project: 'P1', kind: 'smm_specialist', add: ['E1'] }, ctx)).rejects.toThrow('права нет');
    });
  });
});
