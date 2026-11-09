import {
  changeHead, changeMessage, dailyMessage, groupShoots, isAnnounced, mapLink, missingTimeMessage, nextWeek, phoneOf,
  producerNoonMessage, readScriptToken, ruLongDay, ruRange, scriptToken, todaySummary, weeklyMessage, ProducerShoot, ShootSnapshot,
} from './producer.logic';

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
    expect(text).toContain(`«5 видов кофе за 30 секунд»\nснимает Бехруз\n<a href="${link(shoot())}">📄 Сценарий и всё о съёмке</a>`);
    expect(text).toContain('снимает Сухроб\n<a href="');
    expect(text).toContain('📄 Всё о съёмке</a> · сценария пока нет');
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
    expect(text).toContain('«Самса с тыквой» · Бехруз\n<a href=');
    expect(text).toContain('Накануне в 18:00 придёт напоминание со временем и адресом.');
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

  it('на завтра: адрес с картой, человек на месте и СММ', () => {
    const text = dailyMessage('2026-11-10', [shoot({
      date: '2026-11-10', address: 'ул. Айни, 61', mapUrl: 'https://2gis.tj/x?a=1&b=2',
      contact: 'Фирдавс, +992 90 555 12 12', smm: 'Нигина',
    })], 'x', link, { own: true })!;
    expect(text).toContain('«5 видов кофе за 30 секунд»\n📍 ул. Айни, 61 · <a href="https://2gis.tj/x?a=1&amp;b=2">карта</a>\n👤 На месте: Фирдавс, +992 90 555 12 12\n💬 СММ: Нигина\n<a href=');
  });

  it('другое место — карта ищет его адрес, а не ссылку проекта', () => {
    expect(mapLink({ address: 'ТЦ Сиёма Молл', otherPlace: true, mapUrl: 'https://2gis.tj/x' }))
      .toBe('https://www.google.com/maps/search/?api=1&query=%D0%A2%D0%A6%20%D0%A1%D0%B8%D1%91%D0%BC%D0%B0%20%D0%9C%D0%BE%D0%BB%D0%BB');
    expect(mapLink({ address: 'ул. Айни, 61', otherPlace: false, mapUrl: 'https://2gis.tj/x' })).toBe('https://2gis.tj/x');
    expect(mapLink({ address: null, otherPlace: false, mapUrl: null })).toBeNull();
  });

  it('без времени — видеографу «уточните у продюсера», СММ строкой ниже', () => {
    const text = dailyMessage('2026-10-30', [shoot({ time: null, smm: 'Нигина' })], 'x', link, { own: true })!;
    expect(text).toContain('<b>Время не указано · Кофейня Nur</b>\n«5 видов кофе за 30 секунд»\n🕑 время не указано — уточните у продюсера\n💬 СММ: Нигина\n<a href=');
    const forProducer = dailyMessage('2026-10-30', [shoot({ time: null })], 'x', link)!;
    expect(forProducer).toContain('🕑 время не указано\n');
    expect(forProducer).not.toContain('уточните');
  });

  it('место: студия без карты, у клиента — адрес или «не указан»', () => {
    const studio = dailyMessage('2026-10-30', [shoot({ placeKind: 'studio', address: 'Студия' })], 'x', link)!;
    expect(studio).toContain('\n📍 Студия\n');
    expect(studio).not.toContain('карта');
    const client = dailyMessage('2026-10-30', [shoot({ placeKind: 'client', address: null })], 'x', link)!;
    expect(client).toContain('📍 У клиента — адрес не указан');
  });

  it('один проект в один день — один блок «N рилса» со ссылками на каждый', () => {
    const g = (id: string, title: string, hasScript = false) =>
      shoot({ id, title, hasScript, time: '11:00', projectName: 'Chrono', projectId: 'p1', placeKind: 'studio', address: 'Студия', scriptItemId: id });
    const list = [g('a', 'Рилс 24'), g('b', 'Рилс 25'), g('c', 'Рилс 26'), g('d', 'Рилс 27'),
      shoot({ id: 'e', time: '15:00', projectName: 'Tojiron', projectId: 'p2' })];
    const own = dailyMessage('2026-10-30', list, 'x', link, { own: true })!;
    expect(own.startsWith('🎬 <b>Ваши съёмки на завтра — 2</b>')).toBe(true);
    expect(own).toContain('<b>11:00 · Chrono — 4 рилса</b>\n📄 <a href="https://crm.webrand.tj/public/script/a">«Рилс 24»</a> · ');
    expect(own).toContain('«Рилс 27»</a> · сценариев пока нет\n📍 Студия');
    expect(own.match(/Chrono/g)!.length).toBe(1);
    const week = weeklyMessage('2026-10-26', '2026-11-01', list, 'x', link)!;
    expect(week.startsWith('📅 <b>Съёмки на неделю — 2</b>')).toBe(true);
    expect(week).toContain('<b>11:00</b> · Chrono — 4 рилса · Бехруз\n📍 Студия\n📄 ');
  });

  it('разное время или видеограф — разные выезды', () => {
    const a = shoot({ id: 'a', projectId: 'p1', time: '11:00' });
    const b = shoot({ id: 'b', projectId: 'p1', time: '15:00' });
    const c = shoot({ id: 'c', projectId: 'p1', time: '11:00', assigneeId: 'u2' });
    expect(groupShoots([a, b, c]).length).toBe(3);
    expect(groupShoots([a, { ...a, id: 'a2' }]).length).toBe(1);
  });

  it('продюсеру в 12:00: рилс без съёмки и завтра без времени', () => {
    expect(producerNoonMessage('2026-11-10', [shoot({ date: '2026-11-10' })], [], 'https://crm')).toBeNull();
    const text = producerNoonMessage('2026-11-10', [
      shoot({ date: '2026-11-10', time: null, projectName: 'Chrono', projectId: 'p1' }),
      shoot({ id: 'b', date: '2026-11-10', time: null, projectName: 'Chrono', projectId: 'p1' }),
    ], [{ projectName: 'Paradise Hall', title: 'Рилс 1', date: '2026-11-10', cancelled: true }], 'https://crm')!;
    expect(text.startsWith('⏰ <b>Нужно назначить — 2</b>')).toBe(true);
    expect(text).toContain('<b>Paradise Hall</b> · «Рилс 1»\nвыход: вторник, 10 ноября — съёмку отменили');
    expect(text).toContain('<b>Завтра без времени</b> · вторник, 10 ноября\nChrono · 2 рилса');
    expect(text).toContain('<a href="https://crm/smm">Открыть умный календарь</a>');
  });

  it('продюсеру в 18:00: сегодня снято, смонтированные раньше не считаем', () => {
    expect(todaySummary('2026-11-30', [shoot({ date: '2026-11-29' })])).toBeNull();
    const text = todaySummary('2026-11-30', [
      shoot({ id: 'a', date: '2026-11-30', projectName: 'Chrono', done: true }),
      shoot({ id: 'b', date: '2026-11-30', projectName: 'Chrono', done: true }),
      shoot({ id: 'c', date: '2026-11-30', projectName: 'Paradise Hall' }),
      shoot({ id: 'd', date: '2026-11-30', projectName: 'Webrand', done: true, edited: true }),
    ])!;
    expect(text).toBe('📋 <b>Сегодня</b>\n✅ Chrono — снято 2 из 2\n⏳ Paradise Hall — снято 0 из 1');
  });

  it('телефон из контакта', () => {
    expect(phoneOf('Фирдавс, +992 90 555 12 12')).toBe('+992905551212');
    expect(phoneOf('администратор Зарина 93-444-55-66')).toBe('934445566');
    expect(phoneOf('Фирдавс')).toBeNull();
    expect(phoneOf(null)).toBeNull();
  });

  it('напоминание СММ: только съёмки без времени', () => {
    expect(missingTimeMessage('2026-11-10', [shoot({ date: '2026-11-10' })], 'https://crm')).toBeNull();
    const text = missingTimeMessage('2026-11-10', [
      shoot({ date: '2026-11-10' }),
      shoot({ id: 'b', date: '2026-11-10', time: null, projectName: 'Viodent', title: 'Отзыв пациента', videographer: null }),
    ], 'https://crm')!;
    expect(text.startsWith('⏰ <b>Завтра съёмка без времени</b>\nвторник, 10 ноября')).toBe(true);
    expect(text).toContain('<b>Viodent</b> · «Отзыв пациента»\nснимает видеограф не назначен');
    expect(text).not.toContain('Кофейня Nur');
    expect(text).toContain('<a href="https://crm/">Указать время</a>');
  });

  it('видеограф уже знает о съёмке: сегодня или завтра после 18:00', () => {
    expect(isAnnounced('2026-11-09', '2026-11-09', 10)).toBe(true);
    expect(isAnnounced('2026-11-10', '2026-11-09', 17)).toBe(false);
    expect(isAnnounced('2026-11-10', '2026-11-09', 18)).toBe(true);
    expect(isAnnounced('2026-11-11', '2026-11-09', 20)).toBe(false);
    expect(isAnnounced(null, '2026-11-09', 20)).toBe(false);
  });

  it('что изменилось', () => {
    const b: ShootSnapshot = { date: '2026-11-10', time: null, place: null, assigneeId: 'u1', status: 'planned' };
    expect(changeHead(b, { ...b, time: '16:00' })).toBe('Время съёмки назначено');
    expect(changeHead({ ...b, time: '11:00' }, { ...b, time: '16:00' })).toBe('Время съёмки изменилось');
    expect(changeHead(b, { ...b, date: '2026-11-12' })).toBe('Съёмку перенесли');
    expect(changeHead(b, { ...b, place: 'ТЦ Сиёма' })).toBe('Место съёмки изменилось');
    expect(changeHead(b, { ...b, status: 'cancelled' })).toBe('Съёмку отменили');
    expect(changeHead(b, { ...b, date: null })).toBe('Съёмку убрали из плана');
    expect(changeHead(b, { ...b, assigneeId: 'u2' })).toBeNull();
    expect(changeHead(b, { ...b })).toBeNull();
    expect(changeHead({ ...b, date: null }, b)).toBe('Добавили съёмку');
    expect(changeHead({ ...b, date: null }, { ...b, date: null, time: '10:00' })).toBeNull();
  });

  it('«время изменилось»: было и стало, адрес и ссылка', () => {
    const before: ShootSnapshot = { date: '2026-11-10', time: '11:00', place: null, assigneeId: 'u1', status: 'planned' };
    const text = changeMessage('Время съёмки изменилось', before,
      shoot({ date: '2026-11-10', time: '16:00', address: 'ул. Рудаки, 84' }), link, { own: true });
    expect(text).toContain('🔁 <b>Время съёмки изменилось</b>\nКофейня Nur · «5 видов кофе за 30 секунд»\nбыло: вторник, 10 ноября, 11:00\nстало: вторник, 10 ноября, <b>16:00</b>\n📍 ул. Рудаки, 84');
    const set = changeMessage('Время съёмки назначено', { ...before, time: null },
      shoot({ date: '2026-11-10', time: '16:00' }), link, { own: true });
    expect(set).toContain('«5 видов кофе за 30 секунд»\nвторник, 10 ноября, <b>16:00</b>\n<a href=');
    expect(set).not.toContain('было:');
    const added = changeMessage('Добавили съёмку', { ...before, date: null },
      shoot({ date: '2026-11-10', time: '16:00' }), link, { own: true });
    expect(added).toContain('«5 видов кофе за 30 секунд»\nвторник, 10 ноября, <b>16:00</b>');
    expect(added).not.toContain('было:');
  });
});
