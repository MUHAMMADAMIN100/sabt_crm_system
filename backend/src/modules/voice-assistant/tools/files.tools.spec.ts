import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import { attachTaskResult, attachTransportReceipt, FILES_TOOLS } from './files.tools';
import { AttachedFile, ToolContext, ToolError } from './types';

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
    upload: (p: string, form: FormData, q?: any) => hit('POST', p, form, q),
  };
}

const ME = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const PROJ = '33333333-3333-4333-8333-333333333333';

const photo = (bytes = 10): AttachedFile => ({
  name: 'photo.jpg', mime: 'image/jpeg', kind: 'photo', download: async () => Buffer.alloc(bytes, 1),
});

function ctxWith(api: any, file?: AttachedFile, user: Partial<any> = {}): ToolContext {
  return {
    user: { id: ME, name: 'Тест', role: 'smm_specialist', secondaryRole: null, extraPermissions: [], deniedPermissions: [], ...user } as any,
    api, refs: new RefTable(), today: '2026-11-10', nowTime: '10:00', utterance: 'тест', file,
  };
}

describe('attach_task_result', () => {
  it('загружает файл в задачу, создаёт результат и даёт отмену из двух шагов', async () => {
    let form: FormData | undefined;
    let resultBody: any;
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет' }),
      'POST /files/upload': (f, q) => { form = f; expect(q).toEqual({ taskId: TASK }); return { id: 'f1', path: '/uploads/files/x.jpg' }; },
      [`POST /tasks/${TASK}/results`]: (b) => { resultBody = b; return { id: 'r1' }; },
    });
    const ctx = ctxWith(api, photo());
    ctx.refs.add('T', TASK, 'Макет');
    const out = await attachTaskResult.run({ task: 'T1' }, ctx);
    expect((form!.get('file') as File).name).toBe('photo.jpg');
    expect(resultBody).toEqual({ type: 'file', content: 'Результат из Telegram: photo.jpg', fileName: 'photo.jpg', filePath: '/uploads/files/x.jpg' });
    expect(out.summary).toContain('Макет');
    expect(out.undo).toEqual([
      { method: 'DELETE', path: `/tasks/${TASK}/results/r1` },
      { method: 'DELETE', path: '/files/f1' },
    ]);
  });

  it('без файла — понятная ошибка', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('T', TASK, 'Макет');
    await expect(attachTaskResult.run({ task: 'T1' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('чужая задача (403 на загрузке) — текст сайта; ничего не остаётся', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет' }),
      'POST /files/upload': () => { throw new ApiError(403, 'Нельзя прикреплять файлы к чужой задаче'); },
    });
    const ctx = ctxWith(api, photo());
    ctx.refs.add('T', TASK, 'Макет');
    await expect(attachTaskResult.run({ task: 'T1' }, ctx)).rejects.toThrow('чужой задаче');
    expect(api.calls.some((c) => c.path.endsWith('/results'))).toBe(false);
  });

  it('если результат не создался — загруженный файл убирается', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет' }),
      'POST /files/upload': () => ({ id: 'f1', path: '/uploads/files/x.jpg' }),
      [`POST /tasks/${TASK}/results`]: () => { throw new ApiError(400, 'ошибка'); },
      'DELETE /files/f1': () => ({}),
    });
    const ctx = ctxWith(api, photo());
    ctx.refs.add('T', TASK, 'Макет');
    await expect(attachTaskResult.run({ task: 'T1' }, ctx)).rejects.toThrow('ошибка');
    expect(api.calls.some((c) => c.method === 'DELETE' && c.path === '/files/f1')).toBe(true);
  });

  it('выдуманная метка отвергается', async () => {
    const ctx = ctxWith(fakeApi({}), photo());
    await expect(attachTaskResult.run({ task: 'T9' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });

  it('права: нужен грант files.upload', () => {
    expect(attachTaskResult.available!({ role: 'designer', extraPermissions: [], deniedPermissions: [] } as any)).toBe(true);
    expect(attachTaskResult.available!({ role: 'designer', extraPermissions: [], deniedPermissions: ['files.upload'] } as any)).toBe(false);
  });
});

describe('attach_transport_receipt', () => {
  const projects = () => [{ id: PROJ, name: 'Архидея', mine: true }];

  it('подтверждение показывает чек; запуск шлёт multipart как сайт и даёт отмену', async () => {
    let form: FormData | undefined;
    const api = fakeApi({
      'GET /transport-requests/projects': projects,
      'POST /transport-requests': (f) => { form = f; return { id: 'tr1' }; },
    });
    const ctx = ctxWith(api, photo());
    const args = { project: 'Архидея', amount: 30, note: 'такси' };
    expect(await attachTransportReceipt.preview!(args, ctx)).toContain('С ЧЕКОМ');
    const out = await attachTransportReceipt.run(args, ctx);
    expect(form!.get('projectId')).toBe(PROJ);
    expect(form!.get('amount')).toBe('30');
    expect(form!.get('date')).toBe('2026-11-10');
    expect(form!.get('note')).toBe('такси');
    expect((form!.get('receipt') as File).type).toBe('image/jpeg');
    expect(out.undo).toEqual([{ method: 'DELETE', path: '/transport-requests/tr1' }]);
    expect(attachTransportReceipt.confirm!(args, ctx)).toBe(true);
  });

  it('PDF вместо фото — отказ до всяких запросов', async () => {
    const api = fakeApi({});
    const pdf: AttachedFile = { name: 'chek.pdf', mime: 'application/pdf', kind: 'document', download: async () => Buffer.alloc(5) };
    await expect(attachTransportReceipt.run({ project: 'Архидея', amount: 30 }, ctxWith(api, pdf))).rejects.toThrow('фото');
    expect(api.calls).toHaveLength(0);
  });

  it('слишком тяжёлое фото, будущая дата, нулевая сумма, неизвестный проект', async () => {
    const mk = (file: AttachedFile) => ctxWith(fakeApi({ 'GET /transport-requests/projects': projects }), file);
    await expect(attachTransportReceipt.run({ project: 'Архидея', amount: 30 }, mk(photo(1_600_000)))).rejects.toThrow('тяжёлое');
    await expect(attachTransportReceipt.run({ project: 'Архидея', amount: 30, date: '2026-12-01' }, mk(photo()))).rejects.toThrow('будущем');
    await expect(attachTransportReceipt.run({ project: 'Архидея', amount: 0 }, mk(photo()))).rejects.toBeInstanceOf(ToolError);
    await expect(attachTransportReceipt.run({ project: 'Несуществующий', amount: 30 }, mk(photo()))).rejects.toThrow('Не нашёл проект');
  });

  it('права: только SMM-специалист и видеограф', () => {
    const can = (role: string) => attachTransportReceipt.available!({ role, secondaryRole: null } as any);
    expect(can('smm_specialist')).toBe(true);
    expect(can('videographer')).toBe(true);
    expect(can('designer')).toBe(false);
  });
});

it('экспорт FILES_TOOLS', () => {
  expect(FILES_TOOLS.map((t) => t.name)).toEqual(['attach_task_result', 'attach_transport_receipt']);
});
