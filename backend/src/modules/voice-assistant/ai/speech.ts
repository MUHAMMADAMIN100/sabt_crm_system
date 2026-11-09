import { GoogleGenerativeAI } from '@google/generative-ai';
import { AiProviderError, classifyAiFailure, speechProviders, SpeechProvider } from './providers';

/**
 * Речь → текст. Голосовые Telegram — OGG/Opus; OpenAI и Groq принимают его
 * как есть (проверено), Gemini — inlineData audio/ogg.
 *
 * hint — подсказка распознавателю: имена сотрудников, проектов, клиентов.
 * Без неё «Фирузу» и «Архидея» превращаются в похожие русские слова.
 * Язык не задаём: владелец говорит и по-русски, и по-таджикски.
 */
export interface Transcript { text: string; provider: string }

const TIMEOUT_MS = 45_000;

/**
 * На коротких фразах модели семейства Whisper иногда возвращают вместо речи
 * саму подсказку («Лашкарова…, Маюнусова…, Тест SMM проект»). Ловим это:
 * если почти все слова «расшифровки» есть в подсказке — это эхо.
 */
export function looksLikeHintEcho(text: string, hint: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-яәғқҳҷӣӯ0-9]+/i).filter((w) => w.length >= 3);
  const t = words(text);
  if (t.length < 2 || !hint) return false;
  const h = new Set(words(hint));
  const share = t.filter((w) => h.has(w)).length / t.length;
  // Короткое эхо — одно ФИО из подсказки целиком; длинное — список имён.
  return t.length < 4 ? share >= 0.99 : share >= 0.6;
}

/** Доля кириллицы среди букв (таджикские ҷ ӣ ӯ қ ғ ҳ — тоже кириллица). */
export function cyrillicShare(text: string): number {
  const letters = String(text || '').match(/\p{L}/gu) || [];
  if (!letters.length) return 1;
  return letters.filter((ch) => /[Ѐ-ӿ]/.test(ch)).length / letters.length;
}

/** Подсказка распознавателю — обычной фразой и не длиннее нужного. */
export function speechPrompt(names: string): string {
  const list = names.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 60).join(', ');
  return list ? `Голосовая команда для CRM агентства. Возможные имена и названия: ${list}.` : '';
}

export async function transcribe(audio: Buffer, hint: string): Promise<Transcript> {
  const providers = speechProviders();
  const errors: AiProviderError[] = [];
  const prompt = speechPrompt(hint);
  for (const p of providers) {
    try {
      let text = p.kind === 'gemini'
        ? await viaGemini(p, audio, hint)
        : await viaTranscriptions(p, audio, prompt);
      if (looksLikeHintEcho(text, `${prompt} ${hint}`)) {
        // Эхо подсказки — переспрашиваем ту же модель без неё.
        text = p.kind === 'gemini' ? await viaGemini(p, audio, '') : await viaTranscriptions(p, audio, '');
        if (looksLikeHintEcho(text, `${prompt} ${hint}`)) text = '';
      }
      // Определение языка на коротких записях ошибается («你好», «Hallo!»).
      // Сотрудники говорят по-русски или по-таджикски (кириллица) — если
      // пришёл чужой алфавит, переспрашиваем с языком «русский».
      if (p.kind === 'transcriptions' && text && cyrillicShare(text) < 0.3) {
        const ru = await viaTranscriptions(p, audio, prompt, 'ru').catch(() => '');
        if (cyrillicShare(ru) > cyrillicShare(text) && !looksLikeHintEcho(ru, `${prompt} ${hint}`)) text = ru;
      }
      return { text: text.trim(), provider: p.id };
    } catch (e: any) {
      errors.push(e instanceof AiProviderError
        ? e
        : new AiProviderError(p.id, 'unknown', null, String(e?.message || e)));
    }
  }
  throw new AllSpeechFailed(errors);
}

export class AllSpeechFailed extends Error {
  constructor(readonly errors: AiProviderError[]) {
    super(errors.map((e) => e.message).join(' | ') || 'нет поставщиков распознавания');
  }
}

async function viaTranscriptions(p: SpeechProvider, audio: Buffer, hint: string, language?: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', p.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  // Whisper ограничивает подсказку ~224 токенами — режем по длине.
  if (hint) form.append('prompt', hint.slice(0, p.id === 'groq' ? 600 : 1500));
  if (language) form.append('language', language);

  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}` },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new AiProviderError(p.id, 'network', null, String(e?.message || e));
  }
  const raw = await res.text();
  if (!res.ok) throw new AiProviderError(p.id, classifyAiFailure(res.status, raw), res.status, raw.slice(0, 300));
  try {
    return String(JSON.parse(raw).text || '');
  } catch {
    throw new AiProviderError(p.id, 'unknown', res.status, `неожиданный ответ: ${raw.slice(0, 120)}`);
  }
}

async function viaGemini(p: SpeechProvider, audio: Buffer, hint: string): Promise<string> {
  const model = new GoogleGenerativeAI(p.key).getGenerativeModel({ model: p.model });
  try {
    const res = await model.generateContent([
      { inlineData: { mimeType: 'audio/ogg', data: audio.toString('base64') } },
      {
        text: 'Распознай речь дословно (русский или таджикский). Верни только текст сказанного, '
          + `без пояснений. Возможные имена и названия: ${hint.slice(0, 1500)}`,
      },
    ]);
    return res.response.text();
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = Number(/\[(\d{3})/.exec(msg)?.[1]) || null;
    throw new AiProviderError(p.id, classifyAiFailure(status, msg), status, msg.slice(0, 300));
  }
}
