import { RefTable } from './refs';
import { classifyAiFailure, explainAllFailed, AiProviderError } from './ai/providers';
import { matchScore, addDays, weekdayRu, dushanbeISO, fmtDeadline } from './tools/common';
import { ToolContext, ToolError } from './tools/types';
import { ApiError } from './internal-api';
import { setTaskStatus, createTask, findTasks, updateTask, deleteTask, VOICE_MARK } from './tools/tasks.tools';
import { shiftPause, shiftStart, pauseKindFromSpeech } from './tools/shifts.tools';
import { NeedChoice } from './tools/types';
import { taskIdFromReply } from '../telegram/telegram.controller';
import { webhookSecretFor } from '../telegram/telegram.service';

jest.mock('./ai/chat', () => {
  const actual = jest.requireActual('./ai/chat');
  return { ...actual, chatStep: jest.fn() };
});
import { chatStep } from './ai/chat';
import { runAgent, runPending } from './agent';

const ME = '11111111-1111-1111-1111-111111111111';
const SABRINA = '22222222-2222-2222-2222-222222222222';
const TASK = '33333333-3333-3333-3333-333333333333';

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
  return {
    user: {
      id: ME, name: 'Тест', role: 'smm_specialist', secondaryRole: null,
      extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user,
    } as any,
    api,
    refs: new RefTable(),
    today: '2026-11-09',
    nowTime: '10:00',
    utterance: 'задачу макет на готово',
  };
}

describe('RefTable', () => {
  it('выдаёт короткие метки и возвращает id, а выдуманные отбрасывает', () => {
    const r = new RefTable();
    const t1 = r.add('T', TASK, 'Макет');
    expect(t1).toBe('T1');
    expect(r.add('T', TASK, 'Макет')).toBe('T1');
    expect(r.resolve('T', 't1')?.id).toBe(TASK);
    expect(r.resolve('T', TASK)?.id).toBe(TASK);
    expect(r.resolve('E', 'T1')).toBeNull();
    expect(r.resolve('T', 'T9')).toBeNull();
    const back = RefTable.fromJSON(JSON.parse(JSON.stringify(r.toJSON())));
    expect(back.resolve('T', 'T1')?.label).toBe('Макет');
    expect(back.add('T', '44444444-4444-4444-4444-444444444444', 'Другая')).toBe('T2');
  });
});

describe('ошибки поставщиков ИИ', () => {
  it('402 и insufficient_quota — это оплата', () => {
    expect(classifyAiFailure(402, '{"error":{"code":402}}')).toBe('billing');
    expect(classifyAiFailure(429, '{"error":{"code":"insufficient_quota"}}')).toBe('billing');
    expect(classifyAiFailure(401, 'Incorrect API key')).toBe('auth');
    expect(classifyAiFailure(429, 'Rate limit reached')).toBe('quota');
    expect(classifyAiFailure(404, 'The model does not exist')).toBe('model');
    expect(classifyAiFailure(503, 'overloaded')).toBe('overload');
    expect(classifyAiFailure(null, 'fetch failed')).toBe('network');
  });
  it('человеку — понятная причина, а не код', () => {
    expect(explainAllFailed([])).toMatch(/OPENAI_API_KEY/);
    expect(explainAllFailed([new AiProviderError('openai', 'billing', 402, 'x')])).toMatch(/баланс/);
    expect(explainAllFailed([new AiProviderError('openai', 'network', null, 'x')])).toMatch(/не отвечает/);
  });
});

describe('помощники дат и поиска', () => {
  it('падежи не мешают найти задачу', () => {
    expect(matchScore('Макет для Архидеи', 'архидея')).toBeGreaterThanOrEqual(0.5);
    expect(matchScore('Сторис Архидея', 'макет архидеи')).toBe(0.5);
    expect(matchScore('Отчёт клиенту', 'архидея')).toBe(0);
  });
  it('даты по Душанбе', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
    expect(weekdayRu('2026-11-09')).toBe('понедельник');
    expect(dushanbeISO('2026-11-10', '15:00')).toBe('2026-11-10T15:00:00+05:00');
    expect(fmtDeadline('2026-11-10T18:59:00Z')).toBe('10 ноября');
  });
});

describe('ответ на карточку задачи', () => {
  it('находит задачу по кнопкам карточки и по ссылке', () => {
    expect(taskIdFromReply({ reply_markup: { inline_keyboard: [[{ callback_data: `t:done:${TASK}` }]] } })).toBe(TASK);
    expect(taskIdFromReply({ reply_markup: { inline_keyboard: [[{ callback_data: `w:res:${TASK}` }]] } })).toBe(TASK);
    expect(taskIdFromReply({ text: `Задача https://crm.webrand.tj/tasks/${TASK}` })).toBe(TASK);
    expect(taskIdFromReply({ text: 'просто текст' })).toBeNull();
    expect(taskIdFromReply(undefined)).toBeNull();
  });
});

describe('подпись webhook', () => {
  it('секрет стабилен и зависит от токена', () => {
    expect(webhookSecretFor('a')).toBe(webhookSecretFor('a'));
    expect(webhookSecretFor('a')).not.toBe(webhookSecretFor('b'));
    expect(webhookSecretFor('a')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('set_task_status', () => {
  it('меняет статус через API и запоминает прежний для отмены', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет', status: 'in_progress', assignees: [] }),
      [`PATCH /tasks/${TASK}`]: () => ({}),
    });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Макет');
    const out = await setTaskStatus.run({ task: 'T1', status: 'done' }, ctx);
    expect(api.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ status: 'done' });
    expect(out.summary).toContain('Готово');
    expect(out.undo).toEqual([{ method: 'PATCH', path: `/tasks/${TASK}`, body: { status: 'in_progress' } }]);
  });

  it('в очереди исполнителей «готово» сдаёт мою часть', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({
        id: TASK, title: 'Ролик', status: 'in_progress',
        assignees: [
          { userId: ME, position: 0, isDone: false, user: { id: ME, name: 'Тест' } },
          { userId: SABRINA, position: 1, isDone: false, user: { id: SABRINA, name: 'Сабрина' } },
        ],
      }),
      [`POST /tasks/${TASK}/my-part-done`]: () => ({ allDone: false }),
    });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Ролик');
    const out = await setTaskStatus.run({ task: 'T1', status: 'done' }, ctx);
    expect(api.calls.some((c) => c.path.endsWith('/my-part-done'))).toBe(true);
    expect(api.calls.some((c) => c.method === 'PATCH')).toBe(false);
    expect(out.summary).toMatch(/дальше Сабрина/);
  });

  it('если сайт требует результат — подсказка и кнопка приложить файл', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет', status: 'in_progress', assignees: [] }),
      [`PATCH /tasks/${TASK}`]: () => { throw new ApiError(400, 'Загрузите результат перед закрытием задачи'); },
    });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Макет');
    await expect(setTaskStatus.run({ task: 'T1', status: 'done' }, ctx)).rejects.toMatchObject({
      buttons: [[{ text: '📎 Приложить результат', callback_data: `w:res:${TASK}` }]],
    });
  });

  it('выдуманную метку не принимает', async () => {
    const ctx = ctxWith(fakeApi({}));
    await expect(setTaskStatus.run({ task: 'T7', status: 'done' }, ctx)).rejects.toBeInstanceOf(ToolError);
  });
});

describe('create_task', () => {
  it('себе — сразу, личная, с меткой голоса и душанбинским сроком', async () => {
    let sent: any;
    const api = fakeApi({ 'POST /tasks': (b) => { sent = b; return { id: TASK, assigneeId: ME }; } });
    const ctx = ctxWith(api);
    expect(createTask.confirm!({ title: 'Позвонить' }, ctx)).toBe(false);
    const out = await createTask.run({ title: 'Позвонить клиенту', date: '2026-11-10', time: '15:00' }, ctx);
    expect(sent.assigneeIds).toEqual([ME]);
    expect(sent.scope).toBe('personal');
    expect(sent.deadline).toBe('2026-11-10T15:00:00+05:00');
    expect(sent.description.startsWith(VOICE_MARK)).toBe(true);
    expect(out.undo?.[0]).toMatchObject({ method: 'DELETE', path: `/tasks/${TASK}` });
  });

  it('другому — только после подтверждения; срок в прошлом не принимает', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('E', SABRINA, 'Сабрина');
    expect(createTask.confirm!({ title: 'Макет', assignees: ['E1'] }, ctx)).toBe(true);
    expect(await createTask.preview!({ title: 'Макет', assignees: ['E1'], date: '2026-11-12' }, ctx)).toMatch(/Сабрина/);
    await expect(createTask.run({ title: 'Макет', date: '2026-11-01' }, ctx)).rejects.toThrow(/прошёл/);
  });
});

describe('find_tasks — права как на сайте', () => {
  it('обычный сотрудник не видит задачи коллег', async () => {
    const ctx = ctxWith(fakeApi({}));
    ctx.refs.add('E', SABRINA, 'Сабрина');
    await expect(findTasks.run({ who: 'E1' }, ctx)).rejects.toThrow(/руководство/);
  });
  it('руководитель видит задачи сотрудника через общий список', async () => {
    const api = fakeApi({
      'GET /tasks': (_b, q) => (q?.assigneeId === SABRINA
        ? [{ id: TASK, title: 'Макет', status: 'new', deadline: '2026-11-10T18:59:00Z', assignee: { id: SABRINA, name: 'Сабрина' } }]
        : []),
    });
    const ctx = ctxWith(api, { role: 'smm_director' });
    ctx.refs.add('E', SABRINA, 'Сабрина');
    const res = await findTasks.run({ who: 'E1' }, ctx);
    expect(res.total).toBe(1);
    expect(res.tasks[0]).toMatchObject({ ref: 'T1', title: 'Макет', status: 'Новая' });
  });
});

describe('update_task и delete_task', () => {
  it('перенос срока сохраняет время и даёт отмену', async () => {
    let patch: any;
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет', status: 'new', deadline: '2026-11-10T10:00:00Z' }),
      [`PATCH /tasks/${TASK}`]: (b) => { patch = b; return {}; },
    });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Макет');
    const out = await updateTask.run({ task: 'T1', date: '2026-11-14' }, ctx);
    expect(patch.deadline).toBe('2026-11-14T15:00:00+05:00');
    expect(out.undo?.[0].body).toEqual({ deadline: '2026-11-10T10:00:00Z' });
  });
  it('удаление всегда через подтверждение', () => {
    expect(deleteTask.confirm!({ task: 'T1' }, ctxWith(fakeApi({})))).toBe(true);
  });
});

describe('смена', () => {
  it('перерыв с причиной', async () => {
    let body: any;
    const api = fakeApi({ 'POST /work-shifts/pause': (b) => { body = b; return { todayMinutes: 125 }; } });
    const ctx = ctxWith(api); ctx.utterance = 'я ушёл на обед';
    const out = await shiftPause.run({ kind: 'personal' }, ctx);
    expect(body).toEqual({ kind: 'lunch' });
    expect(out.summary).toMatch(/обед/);
    expect(out.summary).toMatch(/2 ч 05 мин/);
  });
  it('без причины — вопрос кнопками, а не догадка ИИ', async () => {
    const ctx = ctxWith(fakeApi({})); ctx.utterance = 'поставь на паузу';
    await expect(shiftPause.run({ kind: 'personal' }, ctx)).rejects.toBeInstanceOf(NeedChoice);
    expect(pauseKindFromSpeech('выехал к клиенту на съёмку')).toBe('work');
    expect(pauseKindFromSpeech('поставь на паузу (Человек уточнил кнопкой: «Личное»)')).toBe('personal');
    expect(pauseKindFromSpeech('ба хӯрок рафтам')).toBe('lunch');
  });
  it('уже работающему не начинает смену второй раз', async () => {
    const api = fakeApi({ 'GET /work-shifts/my': () => ({ state: 'working', dayStartedLabel: '09:02' }) });
    const out = await shiftStart.run({}, ctxWith(api));
    expect(out.summary).toMatch(/уже идёт/);
    expect(api.calls.some((c) => c.method === 'POST')).toBe(false);
  });
  it('основателю кнопки смены нет — как на сайте', () => {
    expect(shiftStart.available!({ role: 'founder' } as any)).toBe(false);
    expect(shiftStart.available!({ role: 'designer' } as any)).toBe(true);
  });
});

describe('цикл разбора', () => {
  const step = chatStep as jest.Mock;
  beforeEach(() => step.mockReset());

  const call = (name: string, args: any, id = name) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

  it('успешная запись — итог без лишнего обращения к ИИ', async () => {
    const api = fakeApi({
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет', status: 'new', assignees: [] }),
      [`PATCH /tasks/${TASK}`]: () => ({}),
    });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Макет');
    step.mockResolvedValueOnce({ content: null, toolCalls: [call('set_task_status', { task: 'T1', status: 'in_progress' })], provider: 'openai' });
    const r = await runAgent({ ctx, tools: [setTaskStatus], system: 's', history: [], userText: 'начни задачу макет' });
    expect(step).toHaveBeenCalledTimes(1);
    expect(r.type).toBe('answer');
    expect(r.done[0].outcome?.summary).toMatch(/В работе/);
  });

  it('рискованное — ждёт подтверждения и не выполняется заранее', async () => {
    const api = fakeApi({ [`DELETE /tasks/${TASK}`]: () => ({}) });
    const ctx = ctxWith(api);
    ctx.refs.add('T', TASK, 'Макет');
    step.mockResolvedValueOnce({ content: null, toolCalls: [call('delete_task', { task: 'T1' })], provider: 'openai' });
    const r = await runAgent({ ctx, tools: [deleteTask], system: 's', history: [], userText: 'удали задачу макет' });
    expect(r.type).toBe('confirm');
    expect(api.calls.length).toBe(0);
    if (r.type !== 'confirm') throw new Error();
    const after = await runPending(ctx, [deleteTask], r.pending);
    expect(api.calls[0]).toMatchObject({ method: 'DELETE', path: `/tasks/${TASK}` });
    expect(after.done[0].outcome?.summary).toMatch(/удалена/);
  });

  it('неясно — спрашивает кнопками', async () => {
    const ctx = ctxWith(fakeApi({}));
    step.mockResolvedValueOnce({
      content: null,
      toolCalls: [call('ask_choice', { question: 'Какую задачу?', options: ['Макет — 10 ноября', 'Макет — 12 ноября'] })],
      provider: 'openai',
    });
    const r = await runAgent({ ctx, tools: [setTaskStatus], system: 's', history: [], userText: 'макет готово' });
    expect(r.type).toBe('choice');
    if (r.type === 'choice') expect(r.options).toHaveLength(2);
  });

  it('ошибка инструмента уходит ИИ, и он может поправиться', async () => {
    const api = fakeApi({
      '/tasks/my': () => [],
      'GET /tasks/my': () => [{ id: TASK, title: 'Макет Архидеи', status: 'new', deadline: '2026-11-10T18:59:00Z' }],
      [`GET /tasks/${TASK}`]: () => ({ id: TASK, title: 'Макет Архидеи', status: 'new', assignees: [] }),
      [`PATCH /tasks/${TASK}`]: () => ({}),
    });
    const ctx = ctxWith(api);
    step
      .mockResolvedValueOnce({ content: null, toolCalls: [call('set_task_status', { task: 'T5', status: 'done' }, 'a')], provider: 'openai' })
      .mockResolvedValueOnce({ content: null, toolCalls: [call('find_tasks', { text: 'архидея' }, 'b')], provider: 'openai' })
      .mockResolvedValueOnce({ content: null, toolCalls: [call('set_task_status', { task: 'T1', status: 'done' }, 'c')], provider: 'openai' })
      .mockResolvedValueOnce({ content: 'Готово.', toolCalls: [], provider: 'openai' });
    const r = await runAgent({ ctx, tools: [setTaskStatus, findTasks], system: 's', history: [], userText: 'архидея готово' });
    // Ошибка «нет такой метки» ушла ИИ результатом первого вызова.
    expect(step).toHaveBeenCalledTimes(3); // после успешной записи ИИ больше не зовём
    const finalMessages = step.mock.calls[2][0];
    const firstResult = finalMessages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'a');
    expect(firstResult.content).toMatch(/Нет задачи с меткой/);
    expect(r.done.filter((d) => d.outcome).length).toBe(1);
    expect(api.calls.some((c) => c.method === 'PATCH' && c.body.status === 'done')).toBe(true);
  });
});

import { looksLikeHintEcho, speechPrompt } from './ai/speech';

describe('эхо подсказки распознавания', () => {
  const names = 'Лашкарова Саврибегим Эраджевна, Маюнусова Фарзона Фирдавсовна, Тест SMM проект, ПРВ-Альфа';
  const prompt = speechPrompt(names);
  it('ловит «расшифровку», которая повторяет подсказку', () => {
    expect(looksLikeHintEcho('Лашкарова Саврибегим Эраджевна, Маюнусова Фарзона Фирдавсовна, Тест SMM проект', `${prompt} ${names}`)).toBe(true);
    expect(looksLikeHintEcho('Голосовая команда для CRM агентства. Возможные имена и названия: Лашкарова', `${prompt} ${names}`)).toBe(true);
  });
  it('обычные команды с именами — не эхо', () => {
    expect(looksLikeHintEcho('И перенеси её на пятницу', `${prompt} ${names}`)).toBe(false);
    expect(looksLikeHintEcho('Поставь Фарзоне задачу сделать сторис для Тест SMM проекта', `${prompt} ${names}`)).toBe(false);
    expect(looksLikeHintEcho('Какие задачи у Маюнусовой Фарзоны?', `${prompt} ${names}`)).toBe(false);
  });
});

import { cyrillicShare } from './ai/speech';
import { reasoningFor } from './ai/providers';

describe('язык расшифровки и модели', () => {
  it('чужой алфавит замечаем, русский и таджикский — нет', () => {
    expect(cyrillicShare('你好')).toBe(0);
    expect(cyrillicShare('Hallo!')).toBe(0);
    expect(cyrillicShare('Барои фардо ба ман вазифа илова кун: ба мизоҷ занг задан')).toBe(1);
    expect(cyrillicShare('Поставь задачу для Javonon')).toBeGreaterThan(0.6);
  });
  it('глубина рассуждения по модели', () => {
    delete process.env.OPENAI_REASONING;
    expect(reasoningFor('gpt-5-mini')).toBe('low');
    expect(reasoningFor('gpt-5.4-mini')).toBe('none');
    expect(reasoningFor('gpt-6.1-sol')).toBe('none');
    expect(reasoningFor('gpt-4.1-mini')).toBeUndefined();
  });
});
