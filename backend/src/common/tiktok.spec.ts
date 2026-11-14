import { TIKTOK_FROM, tiktokNeeded } from './tiktok';

describe('нужен ли TikTok публикации', () => {
  it('по умолчанию нужен с дня запуска; у выключенного проекта и раньше — нет', () => {
    expect(TIKTOK_FROM).toBe('2026-11-15');
    expect(tiktokNeeded(false, '2026-11-15')).toBe(true);
    expect(tiktokNeeded(false, '2026-12-01')).toBe(true);
    expect(tiktokNeeded(false, '2026-11-14')).toBe(false);
    expect(tiktokNeeded(true, '2026-12-01')).toBe(false);
    expect(tiktokNeeded(false, null)).toBe(false);
  });
});
