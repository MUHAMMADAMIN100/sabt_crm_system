import { ApiError } from '../internal-api';
import { RefTable } from '../refs';
import { BRIEF_QUESTIONS, BRIEF_TOOLS, briefAnswer, briefFill, briefQuestions } from './brief.tools';
import { ToolContext, ToolError } from './types';

const PROJ = '44444444-4444-4444-4444-444444444444';

function fakeApi(project: () => any) {
  const calls: Array<{ method: string; path: string; body?: any }> = [];
  return {
    calls,
    get: async (p: string) => {
      if (p !== `/projects/${PROJ}`) throw new ApiError(404, 'Not found');
      return project();
    },
    patch: async (p: string, body?: any) => { calls.push({ method: 'PATCH', path: p, body }); return {}; },
    post: async () => ({}), delete: async () => ({}), request: async () => ({}),
  };
}

function ctxWith(api: any, user: Partial<any> = {}): ToolContext {
  const refs = new RefTable();
  refs.add('P', PROJ, 'Архидея');
  return {
    user: { id: 'u1', name: 'Тест', role: 'founder', secondaryRole: null, extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false, ...user } as any,
    api, refs, today: '2026-11-10', nowTime: '10:00', utterance: 'тест',
  };
}

const smm = (brief: any = null) => ({ id: PROJ, projectType: 'SMM', brief });

describe('brief.tools', () => {
  it('37 вопросов, ключи q1..q37, имена уникальны', () => {
    expect(BRIEF_QUESTIONS).toHaveLength(37);
    expect(BRIEF_QUESTIONS[36].key).toBe('q37');
    expect(new Set(BRIEF_TOOLS.map((t) => t.name)).size).toBe(BRIEF_TOOLS.length);
  });

  it('brief_questions: показывает текущие ответы', async () => {
    const api = fakeApi(() => smm({ answers: { q1: 'Архидея' } }));
    const out = await briefQuestions.run({ project: 'P1' }, ctxWith(api));
    expect(out.filled).toBe(1);
    expect(out.questions[0]).toMatchObject({ key: 'q1', answer: 'Архидея' });
    expect(out.questions[1].answer).toBeNull();
  });

  it('не СММ-проект — понятная ошибка', async () => {
    const api = fakeApi(() => ({ id: PROJ, projectType: 'Лендинг' }));
    await expect(briefQuestions.run({ project: 'P1' }, ctxWith(api))).rejects.toThrow('СММ');
  });

  describe('brief_fill', () => {
    it('пустые поля пишет без подтверждения, шлёт поля DTO сайта и даёт undo', async () => {
      const api = fakeApi(() => smm());
      expect(briefFill.confirm?.({ project: 'P1', answers: {} }, ctxWith(api))).toBe(false);
      const out = await briefFill.run({ project: 'P1', answers: { q1: ' Архидея ', q6: 'Дизайн интерьеров' } }, ctxWith(api));
      expect(api.calls[0].body).toEqual({
        tariff: null, clientSignature: '', managerSignature: '', clientPhone: '',
        answers: { q1: 'Архидея', q6: 'Дизайн интерьеров' },
      });
      expect(out.summary).toContain('заполнено 2 из 37');
      expect(out.summary).toContain('Не заполнено (35)');
      expect(out.undo?.[0]).toMatchObject({ method: 'DELETE', path: `/projects/${PROJ}/brief` });
    });

    it('не затирает существующее без overwrite и сообщает об этом', async () => {
      const api = fakeApi(() => smm({ answers: { q1: 'Старое' }, tariff: 'Start' }));
      const out = await briefFill.run({ project: 'P1', answers: { q1: 'Новое', q2: 'Иван' } }, ctxWith(api));
      expect(api.calls[0].body.answers).toEqual({ q1: 'Старое', q2: 'Иван' });
      expect(api.calls[0].body.tariff).toBe('Start');
      expect(out.summary).toContain('Не тронуто');
      expect(out.undo?.[0]).toMatchObject({ method: 'PATCH', body: { answers: { q1: 'Старое' } } });
    });

    it('только конфликты без overwrite — ошибка, ничего не пишет', async () => {
      const api = fakeApi(() => smm({ answers: { q1: 'Старое' } }));
      await expect(briefFill.run({ project: 'P1', answers: { q1: 'Новое' } }, ctxWith(api))).rejects.toThrow('Не тронуто');
      expect(api.calls).toHaveLength(0);
    });

    it('overwrite требует подтверждения и показывает было → станет', async () => {
      const api = fakeApi(() => smm({ answers: { q1: 'Старое' } }));
      const args = { project: 'P1', answers: { q1: 'Новое' }, overwrite: true };
      expect(briefFill.confirm?.(args, ctxWith(api))).toBe(true);
      const pv = await briefFill.preview!(args, ctxWith(api));
      expect(pv).toContain('было: Старое');
      expect(pv).toContain('станет: Новое');
      await briefFill.run(args, ctxWith(api));
      expect(api.calls[0].body.answers.q1).toBe('Новое');
    });

    it('плохой ключ и пустые ответы отклоняются', async () => {
      const api = fakeApi(() => smm());
      await expect(briefFill.run({ project: 'P1', answers: { q99: 'x' } }, ctxWith(api))).rejects.toThrow(ToolError);
      await expect(briefFill.run({ project: 'P1', answers: { q1: '  ' } }, ctxWith(api))).rejects.toThrow('Нечего');
    });

    it('доступен только с грантом projects.brief.manage', () => {
      expect(briefFill.available!({ role: 'founder', extraPermissions: [], deniedPermissions: [] } as any)).toBe(true);
      expect(briefFill.available!({ role: 'videographer', extraPermissions: [], deniedPermissions: [] } as any)).toBe(false);
    });
  });

  describe('brief_answer', () => {
    it('правит один ответ, принимает «5» как ключ, undo возвращает прежний', async () => {
      const api = fakeApi(() => smm({ answers: { q14: 'Все' } }));
      const args = { project: 'P1', key: '14', text: 'Женщины 25–40' };
      expect(briefAnswer.confirm?.(args, ctxWith(api))).toBe(true);
      const out = await briefAnswer.run(args, ctxWith(api));
      expect(api.calls[0].body.answers).toEqual({ q14: 'Женщины 25–40' });
      expect(out.summary).toContain('«Все» → «Женщины 25–40»');
      expect(out.undo?.[0].body.answers).toEqual({ q14: 'Все' });
    });

    it('тот же текст и пустой текст — ошибки', async () => {
      const api = fakeApi(() => smm({ answers: { q1: 'А' } }));
      await expect(briefAnswer.run({ project: 'P1', key: 'q1', text: 'А' }, ctxWith(api))).rejects.toThrow('уже такой');
      await expect(briefAnswer.run({ project: 'P1', key: 'q1', text: ' ' }, ctxWith(api))).rejects.toThrow('Пустой');
    });

    it('403 от API — русский текст', async () => {
      const api = fakeApi(() => smm());
      api.patch = async () => { throw new ApiError(403, 'Not allowed'); };
      await expect(briefAnswer.run({ project: 'P1', key: 'q1', text: 'x' }, ctxWith(api))).rejects.toThrow('нет прав');
    });
  });
});
