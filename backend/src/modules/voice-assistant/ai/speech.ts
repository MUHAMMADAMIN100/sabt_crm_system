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

export async function transcribe(audio: Buffer, hint: string): Promise<Transcript> {
  const providers = speechProviders();
  const errors: AiProviderError[] = [];
  for (const p of providers) {
    try {
      const text = p.kind === 'gemini'
        ? await viaGemini(p, audio, hint)
        : await viaTranscriptions(p, audio, hint);
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

async function viaTranscriptions(p: SpeechProvider, audio: Buffer, hint: string): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(audio)], { type: 'audio/ogg' }), 'voice.ogg');
  form.append('model', p.model);
  form.append('response_format', 'json');
  form.append('temperature', '0');
  // Whisper ограничивает подсказку ~224 токенами — режем по длине.
  if (hint) form.append('prompt', hint.slice(0, p.id === 'groq' ? 600 : 1500));

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
