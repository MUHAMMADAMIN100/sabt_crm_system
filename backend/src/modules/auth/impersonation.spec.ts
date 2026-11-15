import { impersonationDenial } from './impersonation';

describe('impersonationDenial — личные доступы (15.11.2026)', () => {
  const admin = { id: 'a', role: 'admin', extraPermissions: null, deniedPermissions: null };
  const founder = { id: 'f', role: 'founder' };
  const emp = (extra: string[] | null) => ({ id: 'e', role: 'designer', isActive: true, isBlocked: false, extraPermissions: extra });

  it('админ входит к сотруднику без личных доступов', () => {
    expect(impersonationDenial(admin, emp(null))).toBeNull();
  });

  it('админ входит, если личные доступы есть и у него самого', () => {
    expect(impersonationDenial(admin, emp(['projects.edit']))).toBeNull();
  });

  it('админ не входит к сотруднику с доступом, которого у админа нет', () => {
    expect(impersonationDenial(admin, emp(['finance.manage']))).toMatch(/основатель/);
  });

  it('запрет у админа тоже считается', () => {
    const limited = { ...admin, deniedPermissions: ['projects.edit'] };
    expect(impersonationDenial(limited, emp(['projects.edit']))).toMatch(/основатель/);
  });

  it('основатель входит всегда', () => {
    expect(impersonationDenial(founder, emp(['finance.manage']))).toBeNull();
  });

  it('устаревшие ключи вне каталога не мешают', () => {
    expect(impersonationDenial(admin, emp(['old.removed.key']))).toBeNull();
  });
});
