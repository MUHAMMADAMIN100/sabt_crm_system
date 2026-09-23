import { matchEmployeeToUser } from './finance.service';

/** Сопоставление «строка ведомости ↔ аккаунт CRM» по имени.
 *
 *  Сторожевой тест: таджикские буквы раньше выбрасывались как «не буквы»,
 *  «Муҳаммад» превращалось в «му аммад», строка ведомости не находилась —
 *  и человек открывал профиль без своей зарплаты. */
describe('matchEmployeeToUser', () => {
  const emp = (id: string, name: string, userId: string | null = null) => ({ id, name, userId });

  it('находит строку, когда имя записано таджикскими буквами', () => {
    const user = { id: 'u1', name: 'Сафоев Муҳаммад Фарходович' };
    const found = matchEmployeeToUser(user, [user], [emp('e1', 'Сафоев Мухаммад Фарходович')]);
    expect(found?.id).toBe('e1');
  });

  it('находит и в обратную сторону: в CRM по-русски, в ведомости по-таджикски', () => {
    const user = { id: 'u1', name: 'Муҳаммадҷон Қосимӣ' };
    const found = matchEmployeeToUser(user, [user], [emp('e1', 'Мухаммадчон Косими')]);
    expect(found?.id).toBe('e1');
  });

  it('не смотрит на порядок слов и на «ё»', () => {
    const user = { id: 'u1', name: 'Зарипова Умрона' };
    expect(matchEmployeeToUser(user, [user], [emp('e1', 'Умрона Зарипова')])?.id).toBe('e1');
    const p = { id: 'u2', name: 'Пётр Семёнов' };
    expect(matchEmployeeToUser(p, [p], [emp('e2', 'Петр Семенов')])?.id).toBe('e2');
  });

  it('подхватывает строку без отчества', () => {
    const user = { id: 'u1', name: 'Сафоев Муҳаммад Фарходович' };
    expect(matchEmployeeToUser(user, [user], [emp('e1', 'Сафоев Муҳаммад')])?.id).toBe('e1');
  });

  it('молчит, когда кандидатов несколько — чужую зарплату показывать нельзя', () => {
    const user = { id: 'u1', name: 'Сафоев Муҳаммад' };
    const found = matchEmployeeToUser(user, [user], [
      emp('e1', 'Сафоев Мухаммад Фарходович'),
      emp('e2', 'Сафоев Мухаммад Алиевич'),
    ]);
    expect(found).toBeNull();
  });

  it('молчит на тёзках в CRM', () => {
    const user = { id: 'u1', name: 'Сафоев Муҳаммад' };
    const twin = { id: 'u2', name: 'Сафоев Мухаммад' };
    expect(matchEmployeeToUser(user, [user, twin], [emp('e1', 'Сафоев Мухаммад')])).toBeNull();
  });

  it('не берёт уже занятую строку', () => {
    const user = { id: 'u1', name: 'Сафоев Муҳаммад' };
    expect(matchEmployeeToUser(user, [user], [emp('e1', 'Сафоев Мухаммад', 'u9')])).toBeNull();
  });

  it('по одному слову не угадывает', () => {
    const user = { id: 'u1', name: 'Сафоев' };
    expect(matchEmployeeToUser(user, [user], [emp('e1', 'Сафоев Мухаммад')])).toBeNull();
  });
});
