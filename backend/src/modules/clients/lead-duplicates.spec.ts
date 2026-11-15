import { duplicateKeys, instagramKey, isDuplicate, nameKey, phoneKey } from './lead-duplicates';

// Дубли лидов (15.11.2026): телефон — последние 9 цифр, Instagram — без
// «@» и ссылки, название — без регистра и пробелов по краям.

describe('ключи сравнения', () => {
  it('телефон: с кодом страны и без — одно и то же; короче 9 цифр — не сравниваем', () => {
    expect(phoneKey('+992 (900) 11-22-33')).toBe('900112233');
    expect(phoneKey('900112233')).toBe('900112233');
    expect(phoneKey('99290011223 3')).toBe('900112233');
    expect(phoneKey('11-22-33')).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });

  it('Instagram: @, ссылка, регистр, хвост ссылки', () => {
    expect(instagramKey('@Cafe.Safo')).toBe('cafe.safo');
    expect(instagramKey('https://www.instagram.com/cafe.safo/?hl=ru')).toBe('cafe.safo');
    expect(instagramKey('instagram.com/cafe_safo')).toBe('cafe_safo');
    expect(instagramKey('  ')).toBeNull();
    expect(instagramKey('кафе сафо')).toBeNull();
  });

  it('название: регистр и пробелы', () => {
    expect(nameKey('  Кафе   «Сафо» ')).toBe('кафе «сафо»');
    expect(nameKey('')).toBeNull();
  });
});

describe('isDuplicate', () => {
  const keys = duplicateKeys({ name: 'Кофейня Нур', contactPhone: '+992 900 11 22 33', contactInstagram: '@nur.coffee' });

  it('совпадение по любому признаку', () => {
    expect(isDuplicate(keys, { name: ' кофейня нур' })).toBe(true);
    expect(isDuplicate(keys, { name: 'Другое', contactPhone: '900-11-22-33' })).toBe(true);
    expect(isDuplicate(keys, { name: 'Другое', contactInstagram: 'https://instagram.com/NUR.coffee/' })).toBe(true);
  });

  it('старое поле contactInfo — построчно; простое слово инстой не считается', () => {
    expect(isDuplicate(keys, { name: 'X', contactInfo: 'Алишер\n+992 900 11 22 33' })).toBe(true);
    expect(isDuplicate(keys, { name: 'X', contactInfo: 'инста @nur.coffee' })).toBe(true);
    const plain = duplicateKeys({ name: 'Y', contactInstagram: 'cafe' });
    expect(isDuplicate(plain, { name: 'Z', contactInfo: 'это cafe у дороги' })).toBe(false);
  });

  it('похожие, но разные — не дубль', () => {
    expect(isDuplicate(keys, { name: 'Кофейня Нур 2', contactPhone: '+992 900 11 22 34', contactInstagram: '@nur.coffee2' })).toBe(false);
    expect(isDuplicate(duplicateKeys({ name: null }), { name: '' })).toBe(false);
  });
});
