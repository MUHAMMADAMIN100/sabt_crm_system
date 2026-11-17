import { describe, it, expect } from 'vitest'
import {
  ageText, ageWord, bookingError, categoriesText, filterCatalog, heightText, linkItems, metaLine, moveItem,
  orderedTags, parseCastingData, parseLinks, parseTagsParam, phoneHref, planImport, splitName, sumImportResults,
  tabCounts, telegramHref,
} from './casting'

// Только выдуманные люди: реальные данные кастинга в репозиторий не кладём.
const people = [
  { name: 'Тест Тестов', categories: ['actor'], kid: false, tags: ['ads', 'film'] },
  { name: 'Проба Пробная', categories: ['actor', 'model'], kid: false, tags: ['model'] },
  { name: 'Малыш Примеров', categories: ['actor'], kid: true, tags: ['ads'] },
  { name: 'Блог Блогов', categories: ['blogger'], kid: false, tags: ['social', 'ads'] },
] as any[]

describe('Кастинг: возраст словами', () => {
  it('год / года / лет', () => {
    expect(ageWord(1)).toBe('год')
    expect(ageWord(21)).toBe('год')
    expect(ageWord(101)).toBe('год')
    expect(ageWord(2)).toBe('года')
    expect(ageWord(4)).toBe('года')
    expect(ageWord(34)).toBe('года')
    expect(ageWord(5)).toBe('лет')
    expect(ageWord(11)).toBe('лет')
    expect(ageWord(12)).toBe('лет')
    expect(ageWord(14)).toBe('лет')
    expect(ageWord(20)).toBe('лет')
    expect(ageWord(111)).toBe('лет')
  })

  it('подпись возраста и роста', () => {
    expect(ageText(24)).toBe('24 года')
    expect(ageText(null)).toBe('')
    expect(heightText('175')).toBe('175 см')
    expect(heightText('180+')).toBe('180+ см')
    expect(heightText('170 см')).toBe('170 см')
    expect(heightText('  ')).toBe('')
    expect(metaLine({ age: 7, height: '120' })).toBe('7 лет · 120 см')
    expect(metaLine({ age: null, height: '154-155' })).toBe('154-155 см')
    expect(metaLine({ age: null, height: null })).toBe('')
  })
})

describe('Кастинг: подписи', () => {
  it('категории по порядку, у детей — «Дети» впереди', () => {
    expect(categoriesText(['model', 'actor'])).toBe('Актёр · Модель')
    expect(categoriesText(['actor'], true)).toBe('Дети · Актёр')
    expect(categoriesText([])).toBe('')
  })

  it('метки — порядок справочника, чужие ключи отбрасываются', () => {
    expect(orderedTags(['film', 'ads', 'nope'])).toEqual(['ads', 'film'])
    expect(parseTagsParam('social,ads,,x')).toEqual(['ads', 'social'])
    expect(parseTagsParam(null)).toEqual([])
  })

  it('имя: два слова крупно, остальное ниже', () => {
    expect(splitName('Тест Тестов Тестович')).toEqual(['Тест Тестов', 'Тестович'])
    expect(splitName('Тест')).toEqual(['Тест', ''])
  })
})

describe('Кастинг: фильтр каталога', () => {
  it('вкладка, все выбранные метки и поиск по имени', () => {
    expect(filterCatalog(people, { tab: 'all', tags: [], q: '' }).length).toBe(4)
    expect(filterCatalog(people, { tab: 'actor', tags: [], q: '' }).length).toBe(3)
    expect(filterCatalog(people, { tab: 'kids', tags: [], q: '' }).map(p => p.name)).toEqual(['Малыш Примеров'])
    expect(filterCatalog(people, { tab: 'all', tags: ['ads', 'film'], q: '' }).map(p => p.name)).toEqual(['Тест Тестов'])
    expect(filterCatalog(people, { tab: 'all', tags: [], q: '  БЛОГ ' }).map(p => p.name)).toEqual(['Блог Блогов'])
  })

  it('числа на вкладках', () => {
    expect(tabCounts(people)).toEqual({ all: 4, actor: 3, blogger: 1, model: 1, kids: 1 })
  })
})

describe('Кастинг: ссылки', () => {
  it('YouTube — «Видео N», Instagram, прочее; не-http отбрасывается', () => {
    expect(linkItems([
      'https://instagram.com/example',
      'https://youtu.be/abc',
      'javascript:alert(1)',
      'https://www.youtube.com/watch?v=x',
      'https://example.com/page',
    ])).toEqual([
      { href: 'https://instagram.com/example', label: 'Instagram' },
      { href: 'https://youtu.be/abc', label: 'Видео 1' },
      { href: 'https://www.youtube.com/watch?v=x', label: 'Видео 2' },
      { href: 'https://example.com/page', label: 'Ссылка' },
    ])
  })

  it('поле «Ссылки» формы', () => {
    expect(parseLinks('https://a.com/x\n\ninstagram.com/test\njavascript:alert(1)\nhttps://a.com/x\nпросто текст'))
      .toEqual(['https://a.com/x', 'https://instagram.com/test'])
  })

  it('Telegram и телефон', () => {
    expect(telegramHref('@test_user')).toBe('https://t.me/test_user')
    expect(telegramHref('https://t.me/test_user')).toBe('https://t.me/test_user')
    expect(telegramHref('не ник')).toBeNull()
    expect(phoneHref('+992 90 000-00-00')).toBe('tel:+992900000000')
    expect(phoneHref('12')).toBeNull()
  })
})

describe('Кастинг: заявка клиента', () => {
  it('имя и телефон как на сервере', () => {
    expect(bookingError({ name: 'А', phone: '900000000' })).toBe('Укажите имя')
    expect(bookingError({ name: 'Клиент', phone: '12-34' })).toBe('Укажите телефон — хотя бы 7 цифр')
    expect(bookingError({ name: ' Клиент ', phone: '+992 90 000 00 00' })).toBeNull()
  })
})

describe('Кастинг: порядок фото', () => {
  it('перестановка', () => {
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b'])
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b'])
  })
})

describe('Кастинг: импорт', () => {
  const json = JSON.stringify([
    { id: 1, name: 'Тест Один', cats: ['Актёр'], photos: ['photos/t01_0.jpg', 'photos/t01_1.jpg'] },
    { id: 2, name: 'Тест Два', cats: ['Модель'], photos: ['photos/t02_0.jpg'] },
    { id: 3, name: 'Тест Три', cats: ['Блогер'], photos: [] },
    { name: 'без id' },
  ])

  it('data.json разбирается, фото — по имени файла', () => {
    const e = parseCastingData(json)
    expect(e.length).toBe(3)
    expect(e[0].photos).toEqual(['t01_0.jpg', 't01_1.jpg'])
  })

  it('плохой data.json — понятная ошибка', () => {
    let msg = ''
    try { parseCastingData('{oops') } catch (err: any) { msg = err.message }
    expect(msg).toBe('data.json не читается — это не JSON')
    try { parseCastingData('{"a":1}') } catch (err: any) { msg = err.message }
    expect(msg).toBe('В data.json ожидается список людей')
  })

  it('пачки: человек целиком в одной пачке, недостающие и тяжёлые фото — отдельно', () => {
    const files = [
      { name: 't01_0.jpg', size: 100 }, { name: 'T01_1.JPG', size: 100 },
      { name: 't02_0.jpg', size: 10_000 }, { name: 'logo.png', size: 5 }, { name: 'data.json', size: 5 },
    ]
    const entries = parseCastingData(json)
    const plan = planImport(entries, files, { maxPhotos: 2, maxBytes: 1000 })
    expect(plan.batches.length).toBe(1)
    expect(plan.batches[0].entries.length).toBe(3)
    expect(plan.batches[0].files.map(f => f.name)).toEqual(['t01_0.jpg', 'T01_1.JPG'])
    expect(plan.tooBig).toEqual(['t02_0.jpg'])
    expect(plan.photoCount).toBe(2)

    const plan2 = planImport(entries, files.concat([{ name: 't02_0.jpg', size: 10 }]).filter(f => f.size < 1000), { maxPhotos: 2 })
    expect(plan2.batches.length).toBe(2)
    expect(plan2.batches[0].files.length).toBe(2)
    expect(plan2.batches[1].entries.length).toBe(2)
    expect(plan2.missing).toEqual([])

    const plan3 = planImport(entries, [])
    expect(plan3.missing).toEqual(['t01_0.jpg', 't01_1.jpg', 't02_0.jpg'])
    expect(plan3.batches.length).toBe(1)
  })

  it('итог пачек складывается', () => {
    expect(sumImportResults([
      { created: 2, skipped: 1, photos: 5, missingPhotos: ['a.jpg'] },
      { created: 1, skipped: 0, photos: 2, missingPhotos: ['a.jpg', 'b.jpg'] },
    ])).toEqual({ created: 3, skipped: 1, photos: 7, missingPhotos: ['a.jpg', 'b.jpg'] })
  })
})
