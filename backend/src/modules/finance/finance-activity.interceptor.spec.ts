import { CallHandler, ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { FinanceActivityInterceptor } from './finance-activity.interceptor';

describe('FinanceActivityInterceptor', () => {
  it('stores readable before and after snapshots for a successful update', async () => {
    const findOne = jest.fn()
      .mockResolvedValueOnce({ id: 'project-1', name: 'Мукофот', tariff: 7000, status: 'paused' })
      .mockResolvedValueOnce({ id: 'project-1', name: 'Мукофот', tariff: 8000, status: 'active' });
    const save = jest.fn().mockResolvedValue(undefined);
    const repo: any = {
      manager: { getRepository: jest.fn(() => ({ findOne })) },
      create: jest.fn((value) => value),
      save,
    };
    const interceptor = new FinanceActivityInterceptor(repo);
    const request = {
      method: 'PATCH', originalUrl: '/finance/projects/project-1',
      params: { id: 'project-1' }, body: { tariff: 8000, status: 'active' },
      user: { id: 'user-1' },
    };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
    const next = { handle: () => of({ id: 'project-1' }) } as CallHandler;

    await firstValueFrom(interceptor.intercept(context, next));
    await new Promise(resolve => setImmediate(resolve));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({
      action: 'Изменил проект (финансы)',
      userId: 'user-1',
      details: expect.objectContaining({
        before: expect.objectContaining({ tariff: 7000, status: 'paused' }),
        after: expect.objectContaining({ tariff: 8000, status: 'active' }),
      }),
    }));
  });
  it('пишет в журнал выгрузку резервной копии, но не обычные чтения (15.11.2026)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const repo: any = {
      manager: { getRepository: jest.fn(() => ({ findOne: jest.fn() })) },
      create: jest.fn((value) => value),
      save,
    };
    const interceptor = new FinanceActivityInterceptor(repo);
    const run = async (url: string, user: any = { id: 'user-1' }, params: any = {}) => {
      const request = { method: 'GET', originalUrl: url, params, body: {}, user };
      const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
      await firstValueFrom(interceptor.intercept(context, { handle: () => of({ ok: true }) } as CallHandler));
      await new Promise(resolve => setImmediate(resolve));
    };

    await run('/api/finance/backup/export');
    await run('/api/finance/backups/b-1', { id: 'user-1' }, { id: 'b-1' });
    await run('/api/finance/backups');
    await run('/api/finance/overview?ym=2026-11');
    await run('/api/finance/backup/export', { id: 'user-2', impersonatorId: 'admin-1' });

    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: 'user-1', action: 'Скачал резервную копию финансов', route: 'GET /api/finance/backup/export',
    }));
    expect(save).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: 'Открыл снимок данных финансов', details: { objectId: 'b-1' },
    }));
  });
});
