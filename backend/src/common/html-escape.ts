/**
 * Экранирование для Telegram (parse_mode: HTML) и HTML-писем.
 *
 * Любое значение, пришедшее от людей (имя проекта, текст комментария, ответ
 * клиента в брифе), подставляем в разметку только через escapeHtml. Иначе
 * один символ «<» в названии — и Telegram отвечает 400 «can't parse
 * entities», сообщение молча теряется; в письме — HTML-инъекция.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Обрезка УЖЕ размеченного HTML-текста до лимита Telegram (4096) так, чтобы
 * не разрезать сущность («&amp;») посередине. Теги в таких текстах — только
 * наши (<b>, <i>, <a>), поэтому для надёжности при обрезке убираем их совсем.
 */
export function truncateTelegramHtml(html: string, limit = 4000): string {
  if (html.length <= limit) return html;
  const plain = html.replace(/<[^>]*>/g, '');
  let cut = plain.slice(0, limit - 1);
  const amp = cut.lastIndexOf('&');
  if (amp !== -1 && cut.indexOf(';', amp) === -1) cut = cut.slice(0, amp);
  return `${cut}…`;
}
