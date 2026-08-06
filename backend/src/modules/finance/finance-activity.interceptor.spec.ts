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
});
