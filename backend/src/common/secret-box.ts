import * as crypto from 'crypto';

/**
 * Шифрование чувствительных строк, которые нужно уметь ПРОЧИТАТЬ обратно —
 * например, пароль от инстаграма клиента. Для паролей самих сотрудников это
 * не годится (там односторонний bcrypt): здесь речь о чужих учётных данных,
 * которые руководитель должен видеть целиком.
 *
 * AES-256-GCM: шифр с проверкой целостности — подменить содержимое в базе
 * незаметно не выйдет, расшифровка просто упадёт.
 *
 * Ключ берём из ENCRYPTION_KEY, а если его нет — выводим из JWT_SECRET.
 * Отдельная переменная лучше, но требовать её означало бы, что после
 * деплоя раздел молча перестанет работать, пока кто-то не пропишет ключ.
 */
const KEY_INFO = 'sabt-secret-box-v1';

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const source = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!source) throw new Error('Нет ключа шифрования: задайте ENCRYPTION_KEY или JWT_SECRET');
  // scrypt с фиксированной солью: ключ должен получаться одинаковым при
  // каждом запуске, иначе после перезапуска старые записи не расшифруются.
  cachedKey = crypto.scryptSync(source, KEY_INFO, 32);
  return cachedKey;
}

/** Зашифрованное значение как одна строка: v1:<iv>:<tag>:<данные> (base64). */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

/** Обратное преобразование. Возвращает '' на пустом или испорченном значении:
 *  нечитаемый пароль не повод ронять всю карточку проекта. */
export function decryptSecret(stored: string): string {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') return '';
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return '';
  }
}
