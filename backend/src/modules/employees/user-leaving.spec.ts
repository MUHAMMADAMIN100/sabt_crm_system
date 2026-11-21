import { EmployeesService } from './employees.service';
import { EmployeeStatus } from './employee.entity';
import { UsersService } from '../users/users.service';
import { USER_LEAVING } from '../../common/user-events';

/** Сотрудника сделали неактивным или удаляют — сообщаем, чтобы его открытую
 *  работу забрали (21.11.2026). Карточка сотрудника и раздел учёток —
 *  два пути к одному и тому же. */

const UID = '00000000-0000-4000-8000-000000000001';
const founder = { id: 'f', name: 'Основатель', role: 'founder' };

function employees(userActive = true) {
  const order: string[] = [];
  const emp: any = { id: 'e1', userId: UID, fullName: 'Сафоев', status: userActive ? 'active' : 'inactive', position: 'Дизайнер', salary: 0 };
  const svc: any = Object.create(EmployeesService.prototype);
  svc.findOne = jest.fn(async () => ({ ...emp }));
  svc.repo = { update: jest.fn(async () => undefined) };
  svc.userRepo = {
    findOne: jest.fn(async () => ({ id: UID, role: 'designer', secondaryRole: null, isActive: userActive, email: 's@x' })),
    update: jest.fn(async () => { order.push('user.update'); }),
  };
  svc.salaryHistoryRepo = { save: jest.fn(), create: jest.fn() };
  svc.activityLog = { log: jest.fn(async () => undefined) };
  svc.gateway = { notifyUser: jest.fn(), broadcast: jest.fn() };
  svc.mailService = { sendPositionChanged: jest.fn(async () => undefined) };
  svc.telegramService = { sendToUser: jest.fn(async () => undefined) };
  svc.syncVacationAbsences = jest.fn(async () => undefined);
  svc.syncVacationRecord = jest.fn(async () => undefined);
  svc.logger = { warn: jest.fn(), error: jest.fn(), log: jest.fn() };
  svc.events = { emitAsync: jest.fn(async () => { order.push('leaving'); return []; }) };
  const qr = {
    connect: jest.fn(), startTransaction: jest.fn(async () => { order.push('tx'); }),
    commitTransaction: jest.fn(), rollbackTransaction: jest.fn(), release: jest.fn(),
    manager: { query: jest.fn(async () => []), remove: jest.fn(), delete: jest.fn() },
  };
  svc.dataSource = { createQueryRunner: () => qr };
  return { svc: svc as EmployeesService, raw: svc, order };
}

function users(isActive: boolean) {
  const order: string[] = [];
  const user: any = { id: UID, name: 'Сафоев', role: 'designer', secondaryRole: null, isActive };
  const svc: any = Object.create(UsersService.prototype);
  svc.repo = {
    findOne: jest.fn(async () => user),
    save: jest.fn(async (u: any) => u),
    remove: jest.fn(async () => { order.push('remove'); }),
  };
  svc.employeeRepo = { findOne: jest.fn(async () => null), save: jest.fn(), remove: jest.fn() };
  svc.activityLog = { log: jest.fn(async () => undefined) };
  svc.logger = { warn: jest.fn(), log: jest.fn() };
  svc.events = { emitAsync: jest.fn(async () => { order.push('leaving'); return []; }) };
  return { svc: svc as UsersService, raw: svc, user, order };
}

describe('карточка сотрудника: ушёл из работы (21.11.2026)', () => {
  it('статус «Неактивный» — сообщаем, что сотрудник ушёл, после записи в учётку', async () => {
    const { svc, raw, order } = employees();
    await svc.update('e1', { status: EmployeeStatus.INACTIVE } as any, founder);
    expect(raw.events.emitAsync).toHaveBeenCalledWith(USER_LEAVING, { userId: UID });
    expect(order).toEqual(['user.update', 'leaving']);
  });

  it('уже неактивный или правка без смены статуса — не сообщаем', async () => {
    const a = employees(false);
    await a.svc.update('e1', { status: EmployeeStatus.INACTIVE } as any, founder);
    expect(a.raw.events.emitAsync).not.toHaveBeenCalled();
    const b = employees();
    await b.svc.update('e1', { phone: '900000000' } as any, founder);
    expect(b.raw.events.emitAsync).not.toHaveBeenCalled();
  });

  it('отпуск — это не уход', async () => {
    const { svc, raw } = employees();
    await svc.update('e1', { status: EmployeeStatus.VACATION, vacationUntil: '2026-12-01' } as any, founder);
    expect(raw.events.emitAsync).not.toHaveBeenCalled();
  });

  it('сбой у слушателя не отменяет смену статуса', async () => {
    const { svc, raw } = employees();
    raw.events.emitAsync.mockRejectedValueOnce(new Error('boom'));
    await expect(svc.update('e1', { status: EmployeeStatus.INACTIVE } as any, founder)).resolves.toBeDefined();
    expect(raw.logger.warn).toHaveBeenCalled();
  });

  it('удаление — сообщаем ДО удаления: потом ключ обнулит исполнителя карточек', async () => {
    const { svc, order } = employees();
    await svc.remove('e1', founder);
    expect(order).toEqual(['leaving', 'tx']);
  });
});

describe('учётки: выключить и удалить (21.11.2026)', () => {
  it('выключили — сообщаем; включили обратно — нет', async () => {
    const on = users(true);
    await on.svc.toggleActive(UID, founder);
    expect(on.user.isActive).toBe(false);
    expect(on.raw.events.emitAsync).toHaveBeenCalledWith(USER_LEAVING, { userId: UID });
    const off = users(false);
    await off.svc.toggleActive(UID, founder);
    expect(off.raw.events.emitAsync).not.toHaveBeenCalled();
  });

  it('удаление — сообщаем до удаления', async () => {
    const { svc, order } = users(true);
    await svc.remove(UID, founder);
    expect(order).toEqual(['leaving', 'remove']);
  });
});
