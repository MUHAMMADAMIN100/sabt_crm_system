import { createHmac } from 'crypto';
import { describeWebhook, parseInstagramWebhook } from './instagram-events';
import { isMediaLink, signedByMeta, MessengerError } from './meta-http';
import { failureOf, messagePreview, replyUntil, splitText } from './direct-text';
import { DirectFiles } from './direct-files';
import { snippetOf } from './direct.service';
import { openToken, sealToken } from './instagram.api';
import { bindsOnReply, canLead, canReply, canTransfer, isSalesManager, isTop } from './direct-access';

const ACCOUNT = '17841400000000001';
const CLIENT = '987654321';

const envelope = (messaging: unknown[]) => ({ object: 'instagram', entry: [{ id: ACCOUNT, time: 1, messaging }] });

describe('parseInstagramWebhook — разбор уведомлений Instagram', () => {
  it('сообщение клиента: текст, отправитель — собеседник, время из timestamp', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1762240000000, message: { mid: 'm1', text: 'Сколько стоит сайт?' } },
    ]));
    expect(event).toMatchObject({ kind: 'message', outgoing: false, contactId: CLIENT, accountId: ACCOUNT, externalId: 'm1', text: 'Сколько стоит сайт?' });
    expect((event as any).sentAt.getTime()).toBe(1762240000000);
  });

  it('эхо (is_echo) — исходящее, переписка с получателем', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: ACCOUNT }, recipient: { id: CLIENT }, timestamp: 1, message: { mid: 'm2', text: 'Здравствуйте!', is_echo: true } },
    ]));
    expect(event).toMatchObject({ kind: 'message', outgoing: true, contactId: CLIENT });
  });

  it('кнопка «Тестировать» Meta шлёт формат changes — он тоже читается', () => {
    const body = { object: 'instagram', entry: [{ id: '0', time: 1, changes: [{ field: 'messages', value: {
      sender: { id: '12334' }, recipient: { id: '23245' }, timestamp: '1527459824', message: { mid: 'random_mid', text: 'random_text' },
    } }] }] };
    const events = parseInstagramWebhook(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'message', externalId: 'random_mid', text: 'random_text', accountId: '0' });
  });

  it('вложения: фото, голосовое, рилс, неизвестное', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'm3', attachments: [
        { type: 'image', payload: { url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1' } },
        { type: 'audio', payload: { url: 'https://cdn.fbsbx.com/v/a.mp4' } },
        { type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/x', title: 'Подпись' } },
        { type: 'weird_new_type', payload: {} },
      ] } },
    ]));
    expect((event as any).attachments.map((a: any) => a.kind)).toEqual(['image', 'audio', 'reel', 'unsupported']);
    expect((event as any).attachments[2].title).toBe('Подпись');
  });

  it('ответ на сторис агентства — сторис первой во вложениях', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'm4', text: '🔥', reply_to: { story: { url: 'https://cdn.fbsbx.com/s.mp4', id: 's1' } } } },
    ]));
    expect((event as any).attachments[0]).toMatchObject({ kind: 'story', url: 'https://cdn.fbsbx.com/s.mp4' });
  });

  it('ссылка не http(s) не пропускается — защита от javascript:', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'm5', attachments: [{ type: 'image', payload: { url: 'javascript:alert(1)' } }] } },
    ]));
    expect((event as any).attachments[0].url).toBeNull();
  });

  it('удаление, реакция, снятие реакции, прочтение', () => {
    const events = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'm6', is_deleted: true } },
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, reaction: { mid: 'm2', action: 'react', emoji: '😍' } },
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, reaction: { mid: 'm2', action: 'unreact' } },
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, read: { mid: 'm2' } },
    ]));
    expect(events.map(e => e.kind)).toEqual(['deleted', 'reaction', 'reaction', 'read']);
    expect((events[1] as any).emoji).toBe('😍');
    expect((events[2] as any).emoji).toBeNull();
    expect((events[1] as any).byContact).toBe(true);
  });

  it('чужой объект и битые элементы не ломают разбор', () => {
    expect(parseInstagramWebhook({ object: 'page', entry: [] })).toEqual([]);
    expect(parseInstagramWebhook(null)).toEqual([]);
    const events = parseInstagramWebhook(envelope([null, { sender: {} }, { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, message: { text: 'без mid' } },
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'ok', text: 'норм' } }]));
    expect(events.map((e: any) => e.externalId)).toEqual(['ok']);
  });

  it('описание для журнала не содержит слов клиента', () => {
    const line = describeWebhook(envelope([{ sender: { id: CLIENT }, recipient: { id: ACCOUNT }, message: { mid: 'x', text: 'секретный текст' } }]));
    expect(line).not.toContain('секретный');
    expect(line).toContain('object=instagram');
  });
});

describe('signedByMeta — подпись уведомления', () => {
  const secret = 'app-secret';
  const body = Buffer.from(JSON.stringify({ object: 'instagram', entry: [] }));
  const sign = (b: Buffer, s = secret) => `sha256=${createHmac('sha256', s).update(b).digest('hex')}`;

  it('верная подпись сырого тела — принимаем', () => {
    expect(signedByMeta(body, sign(body), secret)).toBe(true);
  });
  it('чужой секрет, изменённое тело, нет подписи, нет секрета — отказ', () => {
    expect(signedByMeta(body, sign(body, 'other'), secret)).toBe(false);
    expect(signedByMeta(Buffer.from(body.toString() + ' '), sign(body), secret)).toBe(false);
    expect(signedByMeta(body, undefined, secret)).toBe(false);
    expect(signedByMeta(body, sign(body), '')).toBe(false);
    expect(signedByMeta(undefined, sign(body), secret)).toBe(false);
  });
});

describe('splitText — 1000 байт на сообщение Instagram', () => {
  it('короткий текст — одно сообщение', () => {
    expect(splitText('  Привет  ')).toEqual(['Привет']);
  });
  it('длинный русский текст режется по словам, каждая часть ≤ 1000 байт', () => {
    const text = Array.from({ length: 200 }, (_, i) => `слово${i}`).join(' ');
    const parts = splitText(text);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(1000);
    expect(parts.join(' ')).toBe(text);
  });
  it('эмодзи не режется пополам, слово без пробелов режется по пределу', () => {
    const parts = splitText('😀'.repeat(400));
    for (const part of parts) {
      expect(Buffer.byteLength(part)).toBeLessThanOrEqual(1000);
      expect(part).not.toMatch(/�/);
    }
    expect(parts.join('')).toBe('😀'.repeat(400));
  });
});

describe('окно ответа и коды ошибок', () => {
  it('ответить можно 24 часа после последнего сообщения клиента', () => {
    expect(replyUntil({ lastIncomingAt: new Date('2026-11-04T10:00:00Z') })!.toISOString()).toBe('2026-11-05T10:00:00.000Z');
    expect(replyUntil({ lastIncomingAt: null })).toBeNull();
  });
  it('коды Meta переводятся для людей', () => {
    expect(failureOf(new MessengerError(190, null, ''))).toBe('TOKEN_INVALID');
    expect(failureOf(new MessengerError(10, 2534022, ''))).toBe('WINDOW_CLOSED');
    expect(failureOf(new MessengerError(551, null, ''))).toBe('UNAVAILABLE');
    expect(failureOf(new MessengerError(0, null, ''))).toBe('NETWORK');
    expect(failureOf(new Error('x'))).toBe('REJECTED');
  });
  it('превью: текст, вложение, удалённое', () => {
    expect(messagePreview({ text: 'Здравствуйте' }, [])).toBe('Здравствуйте');
    expect(messagePreview({ text: null }, ['audio'])).toBe('Голосовое сообщение');
    expect(messagePreview({ text: 'x', deletedAt: new Date() }, [])).toBe('Сообщение удалено');
  });
});

describe('isMediaLink — качаем только с серверов Meta', () => {
  it('cdn Meta — да; чужие хосты, http и внутренняя сеть — нет', () => {
    expect(isMediaLink('https://lookaside.fbsbx.com/x', 'graph.instagram.com')).toBe(true);
    expect(isMediaLink('https://scontent.cdninstagram.com/v/x.jpg', 'graph.instagram.com')).toBe(true);
    expect(isMediaLink('http://lookaside.fbsbx.com/x', 'graph.instagram.com')).toBe(false);
    expect(isMediaLink('https://evil.com/fbsbx.com', 'graph.instagram.com')).toBe(false);
    expect(isMediaLink('https://fbsbx.com.evil.com/x', 'graph.instagram.com')).toBe(false);
    expect(isMediaLink('http://169.254.169.254/latest', 'graph.instagram.com')).toBe(false);
    expect(isMediaLink('не ссылка', 'graph.instagram.com')).toBe(false);
  });
});

describe('DirectFiles — проверка файлов и подписанные ссылки', () => {
  const files = new DirectFiles();
  const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
  const pdf = Buffer.from('%PDF-1.7 ...');

  it('JPG и PDF принимаются, тип — по первым байтам', () => {
    expect(files.checkOutgoing({ originalname: 'kp.pdf', size: pdf.length, buffer: pdf }).kind).toBe('file');
    expect(files.checkOutgoing({ originalname: 'photo.JPEG', size: jpg.length, buffer: jpg })).toMatchObject({ kind: 'image', extension: '.jpg' });
  });
  it('подмена расширения, чужой тип и пустой файл — отказ', () => {
    expect(() => files.checkOutgoing({ originalname: 'virus.pdf', size: jpg.length, buffer: jpg })).toThrow();
    expect(() => files.checkOutgoing({ originalname: 'page.html', size: 3, buffer: Buffer.from('<a>') })).toThrow();
    expect(() => files.checkOutgoing(undefined)).toThrow();
  });
  it('русское имя файла не превращается в кракозябры', () => {
    const latin1 = Buffer.from('КП WebRand.pdf', 'utf8').toString('latin1');
    expect(files.checkOutgoing({ originalname: latin1, size: pdf.length, buffer: pdf }).name).toBe('КП WebRand.pdf');
  });
  it('подписанная ссылка работает сутки и только для своего файла', () => {
    const now = Date.now();
    const path = files.signedPath('media', 'abc', now);
    const url = new URL(`http://x${path}`);
    const e = url.searchParams.get('e')!;
    const s = url.searchParams.get('s')!;
    expect(files.verify('media', 'abc', e, s, now)).toBe(true);
    expect(files.verify('media', 'other', e, s, now)).toBe(false);
    expect(files.verify('avatar', 'abc', e, s, now)).toBe(false);
    expect(files.verify('media', 'abc', e, s, now + 26 * 60 * 60 * 1000)).toBe(false);
    expect(files.verify('media', 'abc', e, 'forged', now)).toBe(false);
  });
  it('в пределах часа ссылка одна и та же — браузер берёт файл из кэша', () => {
    const hour = Math.floor(Date.now() / 3_600_000) * 3_600_000;
    expect(files.signedPath('avatar', 'x', hour + 1_000)).toBe(files.signedPath('avatar', 'x', hour + 3_500_000));
    expect(files.signedPath('avatar', 'x', hour + 1_000)).not.toBe(files.signedPath('avatar', 'x', hour + 3_700_000));
  });
});

describe('кто ведёт чат — правила закрепления (решение владельца 06.11.2026)', () => {
  const smm = { id: 'smm', role: 'sales_manager_smm' };
  const dev = { id: 'dev', role: 'sales_manager_dev' };
  const designerSales = { id: 'ds', role: 'designer', secondaryRole: 'sales_manager_dev' };
  const admin = { id: 'adm', role: 'admin' };
  const founder = { id: 'fnd', role: 'founder' };
  const adminAlsoSales = { id: 'adm2', role: 'admin', secondaryRole: 'sales_manager_smm' };
  const designer = { id: 'des', role: 'designer' };

  it('менеджер продаж — по основной или второй роли; руководство им не считается', () => {
    expect(isSalesManager(smm)).toBe(true);
    expect(isSalesManager(dev)).toBe(true);
    expect(isSalesManager(designerSales)).toBe(true);
    expect(isSalesManager(designer)).toBe(false);
    expect(isSalesManager(admin)).toBe(false);
    expect(isSalesManager(adminAlsoSales)).toBe(false);
    expect(isTop(founder)).toBe(true);
    expect(isTop(smm)).toBe(false);
  });

  it('первый ответ менеджера продаж в свободном чате закрепляет; руководство — нет', () => {
    expect(bindsOnReply(smm, null)).toBe(true);
    expect(bindsOnReply(designerSales, null)).toBe(true);
    expect(bindsOnReply(admin, null)).toBe(false);
    expect(bindsOnReply(founder, null)).toBe(false);
    expect(bindsOnReply(adminAlsoSales, null)).toBe(false);
    // уже закреплён — второй ответ ничего не меняет
    expect(bindsOnReply(dev, 'smm')).toBe(false);
  });

  it('закреплённый чат пишет только его менеджер и руководство; свободный — любой', () => {
    expect(canReply(smm, null)).toBe(true);
    expect(canReply(dev, null)).toBe(true);
    expect(canReply(smm, 'smm')).toBe(true);
    expect(canReply(dev, 'smm')).toBe(false);
    expect(canReply(designerSales, 'smm')).toBe(false);
    expect(canReply(admin, 'smm')).toBe(true);
    expect(canReply(founder, 'smm')).toBe(true);
  });

  it('передать чат: руководство — любой, менеджер — только свой', () => {
    expect(canTransfer(admin, 'smm')).toBe(true);
    expect(canTransfer(founder, null)).toBe(true);
    expect(canTransfer(smm, 'smm')).toBe(true);
    expect(canTransfer(dev, 'smm')).toBe(false);
    // свободный чат менеджер не «передаёт» — он закрепляется ответом
    expect(canTransfer(smm, null)).toBe(false);
  });

  it('вести клиентов может только работающий менеджер продаж с доступом к «Директу»', () => {
    expect(canLead({ ...smm, isActive: true, isBlocked: false })).toBe(true);
    expect(canLead(designerSales)).toBe(true);
    expect(canLead({ ...smm, isActive: false })).toBe(false); // уволен
    expect(canLead({ ...smm, isBlocked: true })).toBe(false); // заблокирован
    expect(canLead({ ...smm, deniedPermissions: ['clients.view'] })).toBe(false); // доступ к Базе клиентов отняли
    expect(canLead(designer)).toBe(false);
    expect(canLead(admin)).toBe(false);
  });
});

describe('инструменты чата (13.11.2026)', () => {
  const files = new DirectFiles();
  const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(16)]);

  it('видео MP4 и MOV принимаются как видео, подделка — нет', () => {
    expect(files.checkOutgoing({ originalname: 'ролик.mp4', size: mp4.length, buffer: mp4 })).toMatchObject({ kind: 'video', extension: '.mp4' });
    expect(files.checkOutgoing({ originalname: 'clip.MOV', size: mp4.length, buffer: mp4 })).toMatchObject({ kind: 'video', extension: '.mov' });
    expect(() => files.checkOutgoing({ originalname: 'fake.mp4', size: 5, buffer: Buffer.from('hello') })).toThrow();
    expect(() => files.checkOutgoing({ originalname: 'big.mp4', size: 26 * 1024 * 1024, buffer: mp4 })).toThrow(/25 МБ/);
  });

  it('кусок текста вокруг найденного: с многоточиями, без лишних пробелов', () => {
    const long = `${'а'.repeat(100)} нужен   прайс на таргет ${'б'.repeat(100)}`;
    const s = snippetOf(long, 'прайс', 20);
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    expect(s).toContain('нужен прайс на таргет');
    expect(snippetOf('коротко про прайс', 'ПРАЙС')).toBe('коротко про прайс');
  });

  it('реакция агентства (эхо из приложения) разбирается, а не теряется', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: ACCOUNT }, recipient: { id: CLIENT }, timestamp: 1, reaction: { mid: 'm9', action: 'react', reaction: 'love', emoji: '❤️' } },
    ]));
    expect(event).toMatchObject({ kind: 'reaction', externalId: 'm9', emoji: '❤️', byContact: false, contactId: CLIENT });
  });

  it('цитата клиента: на какое сообщение ответил', () => {
    const [event] = parseInstagramWebhook(envelope([
      { sender: { id: CLIENT }, recipient: { id: ACCOUNT }, timestamp: 1, message: { mid: 'm10', text: 'А что входит?', reply_to: { mid: 'm5' } } },
    ]));
    expect(event).toMatchObject({ kind: 'message', replyToId: 'm5' });
  });
});

describe('ключи дополнительных аккаунтов Instagram', () => {
  it('шифруются и читаются обратно; в базе не видно самого ключа', () => {
    const sealed = sealToken('IGAAtest-token-123');
    expect(sealed).not.toContain('IGAAtest');
    expect(openToken(sealed)).toBe('IGAAtest-token-123');
    expect(sealToken('IGAAtest-token-123')).not.toBe(sealed); // каждый раз свой IV
  });
  it('испорченный или чужой ключ не читается — аккаунт просит переподключения', () => {
    const sealed = sealToken('secret');
    const parts = sealed.split('.');
    parts[3] = Buffer.from('другое').toString('base64url');
    expect(openToken(parts.join('.'))).toBeNull();
    expect(openToken('мусор')).toBeNull();
    expect(openToken(null)).toBeNull();
  });
});
