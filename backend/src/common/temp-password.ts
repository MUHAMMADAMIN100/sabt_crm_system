import { randomInt } from 'crypto';

/** Алфавит без похожих символов (0/O, 1/l/I): временный пароль переписывают
 *  с экрана и диктуют голосом — путаница в одном знаке значит «не пускает». */
export const TEMP_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/**
 * Временный пароль из криптостойкого генератора (15.11.2026).
 *
 * Раньше новым сотрудникам ставился общий пароль «Sabt@2024», а сброс
 * админом брал Math.random — первый знали все, второй предсказуем. Теперь
 * crypto.randomInt и не короче 12 знаков (~70 бит).
 */
export function generateTempPassword(length = 12): string {
  const size = Math.max(12, Math.floor(length) || 0);
  let out = '';
  for (let i = 0; i < size; i++) {
    out += TEMP_PASSWORD_ALPHABET[randomInt(TEMP_PASSWORD_ALPHABET.length)];
  }
  return out;
}
