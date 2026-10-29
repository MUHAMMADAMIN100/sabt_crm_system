import { dailyMessage, nextWeek, readScriptToken, ruLongDay, ruRange, scriptToken, weeklyMessage, ProducerShoot } from './producer.logic';

const ID = '5f0c2a9e-3b1d-4c7a-9e21-0a6b7c8d9e10';
const shoot = (over: Partial<ProducerShoot> = {}): ProducerShoot => ({
  id: 's1', date: '2026-10-30', time: '10:00', projectName: 'Кофейня Nur', title: '5 видов кофе за 30 секунд',
  videographer: 'Бехруз', scriptItemId: ID, hasScript: true, done: false, ...over,
});
const link = (s: ProducerShoot) => `https://crm.webrand.tj/public/script/${s.scriptItemId}`;

describe('producer.logic', () => {
  it('ссылка на сценарий: своя читается, чужая и битая — нет', () => {
    const t = scriptToken(ID, 'secret');
    expect(t).toMatch(/^[0-9a-f]{56}$/);
    expect(readScriptToken(t, 'secret')).toBe(ID);
    expect(readScriptToken(t, 'other-secret')).toBeNull();
    expect(readScriptToken(t.slice(0, -1) + (t.endsWith('0') ? '1' : '0'), 'secret')).toBeNull();
    expect(readScriptToken('abc', 'secret')).toBeNull();
  });

  it('даты по-русски', () => {
    expect(ruLongDay('2026-10-30')).toBe('пятница, 30 октября');
    expect(ruRange('2026-11-02', '2026-11-07')).toBe('2–7 ноября');
    expect(ruRange('2026-11-30', '2026-12-05')).toBe('30 ноября – 5 декабря');
  });

  it('неделя в субботу — со следующего понедельника', () => {
    expect(nextWeek('2026-10-31')).toEqual({ from: '2026-11-02', to: '2026-11-08' });
  });

  it('на завтра: по времени, со ссылкой или «сценария пока нет»', () => {
    const text = dailyMessage('2026-10-30', [
      shoot({ id: 's2', time: '15:00', projectName: 'Fitness Zone', title: 'Тренировка за 15 минут', videographer: 'Сухроб', hasScript: false }),
      shoot(),
      shoot({ id: 's3', date: '2026-10-31' }),
    ], 'https://crm.webrand.tj', link)!;
    expect(text.startsWith('🎬 <b>Съёмки на завтра — 2</b>\nпятница, 30 октября')).toBe(true);
    expect(text.indexOf('10:00 · Кофейня Nur')).toBeLessThan(text.indexOf('15:00 · Fitness Zone'));
    expect(text).toContain(`«5 видов кофе за 30 секунд»\nснимает Бехруз\n<a href="${link(shoot())}">📄 Сценарий</a>`);
    expect(text).toContain('снимает Сухроб\nсценария пока нет');
  });

  it('нет съёмок — ничего не шлём', () => {
    expect(dailyMessage('2026-10-30', [], 'x', link)).toBeNull();
    expect(dailyMessage('2026-10-30', [shoot({ done: true })], 'x', link)).toBeNull();
  });

  it('названия экранируются для Telegram', () => {
    const text = dailyMessage('2026-10-30', [shoot({ projectName: 'A&B <Студия>' })], 'x', link)!;
    expect(text).toContain('A&amp;B &lt;Студия&gt;');
  });

  it('неделя: по дням, пн–сб, ссылка под каждой съёмкой', () => {
    const text = weeklyMessage('2026-11-02', '2026-11-08', [
      shoot({ id: 'a', date: '2026-11-03', time: '16:00', projectName: 'Шоурум Lola', title: 'Образ на осень' }),
      shoot({ id: 'b', date: '2026-11-02', time: '11:00', projectName: 'Dental Pro', title: 'Брекеты: 3 мифа' }),
      shoot({ id: 'c', date: '2026-11-03', time: '10:00', projectName: 'Пекарня Нон', title: 'Самса с тыквой', hasScript: false }),
    ], 'https://crm.webrand.tj', link)!;
    expect(text.startsWith('📅 <b>Съёмки на неделю — 3</b>\n2–7 ноября')).toBe(true);
    expect(text.indexOf('<b>Пн, 2 ноября</b>')).toBeLessThan(text.indexOf('<b>Вт, 3 ноября</b>'));
    expect(text.indexOf('Пекарня Нон')).toBeLessThan(text.indexOf('Шоурум Lola'));
    expect(text).toContain('«Брекеты: 3 мифа» · Бехруз\n<a href=');
    expect(text).toContain('«Самса с тыквой» · Бехруз\nсценария пока нет');
    expect(text).toContain('Накануне каждой съёмки придёт напоминание.');
  });

  it('неделя: воскресенье в заголовке, только если в него есть съёмка', () => {
    const text = weeklyMessage('2026-11-02', '2026-11-08', [shoot({ date: '2026-11-08' })], 'x', link)!;
    expect(text).toContain('\n2–8 ноября\n');
  });

  it('видеографу — «Ваши съёмки», без «снимает …»', () => {
    const day = dailyMessage('2026-10-30', [shoot()], 'x', link, { own: true })!;
    expect(day.startsWith('🎬 <b>Ваши съёмки на завтра — 1</b>')).toBe(true);
    expect(day).not.toContain('снимает');
    expect(day).toContain('«5 видов кофе за 30 секунд»\n<a href=');
    const week = weeklyMessage('2026-11-02', '2026-11-08', [shoot({ date: '2026-11-02' })], 'x', link, { own: true })!;
    expect(week.startsWith('📅 <b>Ваши съёмки на неделю — 1</b>')).toBe(true);
    expect(week).toContain('«5 видов кофе за 30 секунд»\n<a href=');
    expect(week).not.toContain(' · Бехруз');
  });
});
