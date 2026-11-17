import {
  ageOf, bookingProblem, categoriesOf, cleanBooking, cleanLink, cleanLinks, countTalents, dushanbeToday, fullYears,
  isIsoDay, isKid, matchesSearch, matchesTab, parseImportData, parseListQuery, photoBasename, photoKey, tagsOf,
  talentPatch, toListItem, toPublicTalent, TalentRow,
} from './casting.logic';

// Все имена и данные — выдуманные: персональных данных в репозитории нет.
const ID1 = '5f0c2a9e-3b1d-4c7a-9e21-0a6b7c8d9e10';
const ID2 = '6a1d3b0f-4c2e-4d8b-8f32-1b7c8d9e0f21';
const TODAY = '2026-11-17';

const row = (over: Partial<TalentRow> = {}): TalentRow => ({
  id: ID1, name: 'Анна Тестова', categories: ['actor'], city: 'Душанбе', height: '170',
  birthDate: null, ageBase: 25, ageBaseAt: '2026-01-10', tags: ['ads'], experience: 'Реклама кофе',
  links: ['https://example.com/a'], isPublic: true, isArchived: false,
  photos: ['/uploads/casting/a.jpg', '/uploads/casting/b.jpg', '/uploads/casting/c.jpg'], ...over,
});

describe('casting.logic — метки', () => {
  it('подписи и ключи → ключи по порядку, без повторов; неизвестное — мимо', () => {
    expect(categoriesOf(['Актёр', 'Модель', 'Модель', 'Певец'])).toEqual(['actor', 'model']);
    expect(categoriesOf(['актер', 'blogger'])).toEqual(['actor', 'blogger']);
    expect(tagsOf(['Кино и сериалы', 'Ролики для соцсетей', 'Реклама', 'Цирк'])).toEqual(['film', 'social', 'ads']);
    expect(tagsOf(['Модельный опыт', 'Театр', 'Клипы'])).toEqual(['model', 'theatre', 'clips']);
    expect(tagsOf('ads,film')).toEqual(['ads', 'film']);
    expect(tagsOf(null)).toEqual([]);
  });
});

describe('casting.logic — возраст', () => {
  it('день — настоящий', () => {
    expect(isIsoDay('2026-02-28')).toBe(true);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('17.11.2026')).toBe(false);
  });

  it('полных лет', () => {
    expect(fullYears('2010-11-18', TODAY)).toBe(15);
    expect(fullYears('2010-11-17', TODAY)).toBe(16);
  });

  it('по дате рождения, иначе возраст из импорта плюс прошедшие годы, иначе null', () => {
    expect(ageOf({ birthDate: '2010-11-18' }, TODAY)).toBe(15);
    expect(ageOf({ birthDate: '2010-11-17', ageBase: 99 }, TODAY)).toBe(16);
    expect(ageOf({ ageBase: 25, ageBaseAt: '2025-11-17' }, TODAY)).toBe(26);
    expect(ageOf({ ageBase: 25, ageBaseAt: '2025-11-18' }, TODAY)).toBe(25);
    expect(ageOf({ ageBase: 25, ageBaseAt: null }, TODAY)).toBe(25);
    expect(ageOf({ birthDate: 'вчера', ageBase: 30 }, TODAY)).toBe(30);
    expect(ageOf({ birthDate: '2030-01-01' }, TODAY)).toBeNull();
    expect(ageOf({}, TODAY)).toBeNull();
    expect(ageOf(null, TODAY)).toBeNull();
  });

  it('«Дети» — младше 16', () => {
    expect(isKid(15)).toBe(true);
    expect(isKid(16)).toBe(false);
    expect(isKid(null)).toBe(false);
  });

  it('сегодня — по Душанбе', () => {
    expect(dushanbeToday(new Date('2026-11-17T20:00:00Z'))).toBe('2026-11-18');
    expect(dushanbeToday(new Date('2026-11-17T18:00:00Z'))).toBe('2026-11-17');
  });
});

describe('casting.logic — ссылки', () => {
  it('только http(s); без схемы — https', () => {
    expect(cleanLink('https://example.com/a')).toBe('https://example.com/a');
    expect(cleanLink('example.com/a')).toBe('https://example.com/a');
    expect(cleanLink('javascript:alert(1)')).toBeNull();
    expect(cleanLink('ftp://example.com')).toBeNull();
    expect(cleanLink('http://user:pass@example.com')).toBeNull();
    expect(cleanLink('@someone')).toBeNull();
    expect(cleanLinks(['example.com', 'https://example.com', 'плохо', 42])).toEqual(['https://example.com']);
  });
});

describe('casting.logic — импорт data.json', () => {
  it('имя файла фото — без папки', () => {
    expect(photoBasename('photos/t00_0.jpg')).toBe('t00_0.jpg');
    expect(photoBasename('C:\\photos\\t01_2.JPG')).toBe('t01_2.JPG');
    expect(photoBasename('..')).toBeNull();
    expect(photoBasename(5)).toBeNull();
    expect(photoKey('photos/T00_0.JPG')).toBe('t00_0.jpg');
  });

  it('разбирает записи артефакта; без id/имени и повторы id — пропускает', () => {
    const items = parseImportData([
      {
        id: 0, name: ' Анна Тестова ', cats: ['Актёр', 'Блогер'], city: 'Душанбе', height: 175, age: 25,
        tags: ['Реклама', 'Театр'], exp: 'Реклама кофе', links: ['https://example.com/a', 'javascript:x'],
        photos: ['photos/t00_0.jpg', 'photos/t00_1.jpg', 'photos/T00_0.jpg'],
      },
      { id: 0, name: 'Повтор' },
      { name: 'Без id' },
      { id: 'k2', name: 'Борис Пример', cats: ['Модель'], age: null },
      null,
      'строка',
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      sourceKey: 'webrand-casting:0', name: 'Анна Тестова', categories: ['actor', 'blogger'], city: 'Душанбе',
      height: '175', age: 25, tags: ['ads', 'theatre'], experience: 'Реклама кофе', links: ['https://example.com/a'],
      photos: ['t00_0.jpg', 't00_1.jpg'],
    });
    expect(items[1]).toMatchObject({ sourceKey: 'webrand-casting:k2', categories: ['model'], age: null, photos: [] });
  });

  it('не массив — пусто; { talents: [] } — тоже читается', () => {
    expect(parseImportData({})).toEqual([]);
    expect(parseImportData('x')).toEqual([]);
    expect(parseImportData({ talents: [{ id: 1, name: 'Вера Образец' }] })).toHaveLength(1);
  });
});

describe('casting.logic — правка карточки', () => {
  it('новая карточка — нужно имя', () => {
    expect(talentPatch({}, { today: TODAY, creating: true }).error).toBe('Укажите имя');
    expect(talentPatch({ name: '   ' }, { today: TODAY, creating: true }).error).toBe('Укажите имя');
  });

  it('метки, ссылки, пустые строки → null', () => {
    const { patch, error } = talentPatch(
      { name: '  Новый   Человек ', categories: ['Актёр'], tags: ['film'], links: ['example.com'], city: '', isPublic: false },
      { today: TODAY, creating: true },
    );
    expect(error).toBeNull();
    expect(patch).toEqual({
      name: 'Новый Человек', categories: ['actor'], tags: ['film'], links: ['https://example.com'], city: null, isPublic: false,
    });
  });

  it('дата рождения — настоящая и не в будущем', () => {
    expect(talentPatch({ birthDate: '2030-01-01' }, { today: TODAY, creating: false }).error).toMatch(/Дата рождения/);
    expect(talentPatch({ birthDate: '2026-02-30' }, { today: TODAY, creating: false }).error).toMatch(/Дата рождения/);
    expect(talentPatch({ birthDate: '' }, { today: TODAY, creating: false }).patch).toEqual({ birthDate: null });
    expect(talentPatch({ birthDate: '2001-05-04' }, { today: TODAY, creating: false }).patch).toEqual({ birthDate: '2001-05-04' });
  });

  it('возраст: меняем, только если он другой и нет даты рождения', () => {
    const current = { birthDate: null, ageBase: 25, ageBaseAt: '2026-01-10' };
    expect(talentPatch({ age: 25 }, { today: TODAY, creating: false, current }).patch).toEqual({});
    expect(talentPatch({ age: 26 }, { today: TODAY, creating: false, current }).patch).toEqual({ ageBase: 26, ageBaseAt: TODAY });
    expect(talentPatch({ age: null }, { today: TODAY, creating: false, current }).patch).toEqual({ ageBase: null, ageBaseAt: null });
    expect(talentPatch({ age: 40 }, { today: TODAY, creating: false, current: { birthDate: '2000-01-01' } }).patch).toEqual({});
    expect(talentPatch({ age: 'много' }, { today: TODAY, creating: false, current }).error).toMatch(/Возраст/);
    // Форма CRM зовёт поле ageBase — смысл тот же.
    expect(talentPatch({ ageBase: 30 }, { today: TODAY, creating: false, current }).patch).toEqual({ ageBase: 30, ageBaseAt: TODAY });
    expect(talentPatch({ ageBase: 25 }, { today: TODAY, creating: false, current }).patch).toEqual({});
    expect(talentPatch({ name: 'Вера Образец', ageBase: 12 }, { today: TODAY, creating: true }).patch)
      .toEqual({ name: 'Вера Образец', ageBase: 12, ageBaseAt: TODAY });
  });

  it('флаги — только да/нет', () => {
    expect(talentPatch({ isArchived: true }, { today: TODAY, creating: false }).patch).toEqual({ isArchived: true });
    expect(talentPatch({ isPublic: 'yes' }, { today: TODAY, creating: false }).error).toMatch(/isPublic/);
  });
});

describe('casting.logic — список', () => {
  it('карточка: первое и второе фото, возраст, «ребёнок»', () => {
    const it1 = toListItem(row(), TODAY);
    expect(it1).toMatchObject({ photo: '/uploads/casting/a.jpg', photo2: '/uploads/casting/b.jpg', photosCount: 3, age: 25, kid: false });
    const it2 = toListItem(row({ photos: [], birthDate: '2015-03-01' }), TODAY);
    expect(it2).toMatchObject({ photo: null, photo2: null, photosCount: 0, age: 11, kid: true });
  });

  it('публичная карточка — без внутренних полей', () => {
    const p = toPublicTalent({ ...row(), phone: '+992 00 000 00 00', notes: 'внутреннее' } as any, TODAY);
    expect(Object.keys(p).sort()).toEqual(
      ['age', 'categories', 'city', 'experience', 'height', 'id', 'kid', 'links', 'name', 'photos', 'tags'].sort(),
    );
    expect(p.photos).toHaveLength(3);
  });

  it('разбор запроса', () => {
    expect(parseListQuery({ search: ' Анна ', category: 'actor', tags: 'ads,film', kids: '1', archived: 'true' }))
      .toEqual({ search: 'анна', category: 'actor', tags: ['ads', 'film'], kids: true, archived: true });
    expect(parseListQuery({ category: 'kids' })).toMatchObject({ category: null, kids: true });
    expect(parseListQuery({})).toEqual({ search: '', category: null, tags: [], kids: false, archived: false });
  });

  it('поиск по имени (ё = е), чипы — любой из выбранных, вкладки', () => {
    const a = { name: 'Анна Ёлкина', tags: ['ads'], categories: ['actor'], kid: false };
    expect(matchesSearch(a, { search: 'елкина', tags: [] })).toBe(true);
    expect(matchesSearch(a, { search: 'борис', tags: [] })).toBe(false);
    expect(matchesSearch(a, { search: '', tags: ['film', 'ads'] })).toBe(true);
    expect(matchesSearch(a, { search: '', tags: ['film'] })).toBe(false);
    expect(matchesTab(a, { category: 'actor', kids: false })).toBe(true);
    expect(matchesTab(a, { category: 'model', kids: false })).toBe(false);
    expect(matchesTab(a, { category: null, kids: true })).toBe(false);
  });

  it('счётчики вкладок', () => {
    expect(countTalents([
      { categories: ['actor', 'blogger'], kid: false },
      { categories: ['model'], kid: true },
      { categories: [], kid: false },
    ])).toEqual({ all: 3, actor: 1, blogger: 1, model: 1, kids: 1 });
  });
});

describe('casting.logic — заявка с каталога', () => {
  const ok = { talentIds: [ID1], name: 'Ив', phone: '+992 90 123 45 67', comment: '  Нужны на субботу ' };

  it('ловушка website — тихий «ok»', () => {
    expect(cleanBooking({ ...ok, website: 'http://spam.example' }).spam).toBe(true);
    expect(cleanBooking({ ...ok, website: '' }).spam).toBe(false);
  });

  it('правильная заявка', () => {
    const r = cleanBooking({ ...ok, talentIds: [ID1, ID1.toUpperCase(), 'мусор', ID2] });
    expect(r.error).toBeNull();
    expect(r.value).toEqual({ talentIds: [ID1, ID2], name: 'Ив', phone: '+992 90 123 45 67', comment: 'Нужны на субботу' });
  });

  it('имя 2–100, телефон ≥ 7 цифр, 1–10 человек', () => {
    expect(cleanBooking({ ...ok, name: 'И' }).error).toMatch(/имя/);
    expect(cleanBooking({ ...ok, phone: '12-34-5' }).error).toMatch(/телефон/);
    expect(cleanBooking({ ...ok, talentIds: [] }).error).toMatch(/хотя бы одного/);
    expect(cleanBooking({ ...ok, talentIds: ['abc'] }).error).toMatch(/хотя бы одного/);
    const many = Array.from({ length: 11 }, (_, i) => `5f0c2a9e-3b1d-4c7a-9e21-0a6b7c8d9e${String(i).padStart(2, '0')}`);
    expect(cleanBooking({ ...ok, talentIds: many }).error).toMatch(/не больше 10/);
  });

  it('текст лида: люди со ссылками и комментарий', () => {
    expect(bookingProblem([{ id: '1', name: 'Анна' }, { id: '2', name: 'Борис' }], 'Нужны на субботу', 'https://crm.example.tj/'))
      .toBe('Кастинг: Анна (https://crm.example.tj/casting/1), Борис (https://crm.example.tj/casting/2)\nКомментарий: Нужны на субботу');
    expect(bookingProblem([{ id: '1', name: 'Анна' }], null, 'https://crm.example.tj'))
      .toBe('Кастинг: Анна (https://crm.example.tj/casting/1)');
  });
});
