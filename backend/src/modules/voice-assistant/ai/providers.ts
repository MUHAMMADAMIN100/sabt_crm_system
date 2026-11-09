/**
 * Поставщики ИИ для голосового помощника.
 *
 * Порядок (решение владельца 09.11.2026): OpenAI — основной, Groq и Gemini —
 * запасные. Все трое говорят на одном языке — формате OpenAI Chat Completions
 * (у Groq и Gemini есть совместимые адреса), поэтому разбор команд один на
 * всех, а смена поставщика — это смена адреса и ключа.
 *
 * Голосовые 09.11 легли потому, что у Gemini кончился предоплаченный баланс
 * (402), а запасного пути для разбора смысла не было. Отсюда правило: любой
 * отказ поставщика (оплата, ключ, лимит, сбой) — не ошибка для человека, а
 * повод сразу идти к следующему.
 */

export type ProviderId = 'openai' | 'groq' | 'gemini';

export interface ChatProvider {
  id: ProviderId;
  label: string;
  baseUrl: string;
  key: string;
  model: string;
  /** Модели рассуждения (gpt-5*, gpt-oss) принимают reasoning_effort. */
  reasoning?: 'minimal' | 'low' | 'medium';
}

export interface SpeechProvider {
  id: ProviderId;
  label: string;
  key: string;
  model: string;
  /** OpenAI и Groq — /audio/transcriptions; Gemini — через generateContent. */
  kind: 'transcriptions' | 'gemini';
  baseUrl?: string;
}

const env = (name: string): string => String(process.env[name] || '').trim();

export function chatProviders(): ChatProvider[] {
  const list: ChatProvider[] = [];
  if (env('OPENAI_API_KEY')) {
    const model = env('OPENAI_MODEL') || 'gpt-5-mini';
    list.push({
      id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
      key: env('OPENAI_API_KEY'), model,
      reasoning: /^(gpt-5|o\d)/.test(model) ? ((env('OPENAI_REASONING') as any) || 'low') : undefined,
    });
  }
  if (env('GROQ_API_KEY')) {
    const model = env('GROQ_MODEL') || 'openai/gpt-oss-120b';
    list.push({
      id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1',
      key: env('GROQ_API_KEY'), model,
      reasoning: /gpt-oss/.test(model) ? 'low' : undefined,
    });
  }
  if (env('GEMINI_API_KEY')) {
    list.push({
      id: 'gemini', label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      key: env('GEMINI_API_KEY'), model: env('GEMINI_MODEL') || 'gemini-2.5-flash',
    });
  }
  return list;
}

export function speechProviders(): SpeechProvider[] {
  const list: SpeechProvider[] = [];
  if (env('OPENAI_API_KEY')) {
    list.push({
      id: 'openai', label: 'OpenAI', key: env('OPENAI_API_KEY'), kind: 'transcriptions',
      baseUrl: 'https://api.openai.com/v1', model: env('OPENAI_TRANSCRIBE_MODEL') || 'gpt-4o-transcribe',
    });
  }
  if (env('GROQ_API_KEY')) {
    list.push({
      id: 'groq', label: 'Groq', key: env('GROQ_API_KEY'), kind: 'transcriptions',
      baseUrl: 'https://api.groq.com/openai/v1', model: env('GROQ_TRANSCRIBE_MODEL') || 'whisper-large-v3',
    });
  }
  if (env('GEMINI_API_KEY')) {
    list.push({
      id: 'gemini', label: 'Gemini', key: env('GEMINI_API_KEY'), kind: 'gemini',
      model: env('GEMINI_MODEL') || 'gemini-2.5-flash',
    });
  }
  return list;
}

/** Почему поставщик отказал — словами, чтобы и лог, и человек поняли. */
export type AiFailure = 'billing' | 'auth' | 'quota' | 'model' | 'overload' | 'network' | 'bad_request' | 'unknown';

export class AiProviderError extends Error {
  constructor(
    readonly provider: ProviderId,
    readonly failure: AiFailure,
    readonly status: number | null,
    message: string,
  ) {
    super(`${provider} ${status ?? '-'} ${failure}: ${message}`);
  }
}

export function classifyAiFailure(status: number | null, body: string): AiFailure {
  const b = body || '';
  if (status === 402 || /insufficient_quota|billing|prepayment|credits? (are )?depleted|payment required/i.test(b)) return 'billing';
  if (status === 401 || /invalid[_ ]api[_ ]key|API key not valid|API_KEY_INVALID|incorrect api key/i.test(b)) return 'auth';
  if (status === 403) return 'auth';
  if (status === 429 || /rate.?limit|RESOURCE_EXHAUSTED|quota/i.test(b)) return 'quota';
  if (status === 404 || /model_not_found|does not exist|decommissioned|not supported|not found/i.test(b)) return 'model';
  if (status !== null && status >= 500) return 'overload';
  if (status === null) return 'network';
  if (status === 400 || status === 413 || status === 422) return 'bad_request';
  return 'unknown';
}

/** Человеческое объяснение, когда отказали ВСЕ поставщики. */
export function explainAllFailed(errors: AiProviderError[]): string {
  if (!errors.length) {
    return '⚙️ Голосовой помощник не настроен: на сервере нет ключа ИИ (OPENAI_API_KEY).';
  }
  const kinds = new Set(errors.map((e) => e.failure));
  const names = [...new Set(errors.map((e) => e.provider))].map((p) => (
    p === 'openai' ? 'OpenAI' : p === 'groq' ? 'Groq' : 'Gemini'
  ));
  if (kinds.size === 1 && kinds.has('billing')) {
    return `💳 Кончился оплаченный баланс ИИ (${names.join(', ')}). Пополните баланс — и голосовые снова заработают.`;
  }
  if (kinds.has('billing') && errors.find((e) => e.provider === 'openai')?.failure === 'billing') {
    return '💳 Кончился баланс OpenAI, а запасные поставщики тоже не ответили. Пополните баланс OpenAI.';
  }
  if ([...kinds].every((k) => k === 'network' || k === 'overload')) {
    return '⏳ Сервис ИИ сейчас не отвечает. Попробуйте ещё раз через минуту.';
  }
  if ([...kinds].every((k) => k === 'quota')) {
    return '📊 Исчерпан лимит запросов к ИИ. Попробуйте через минуту.';
  }
  if (kinds.has('auth')) {
    return '🔑 Ключ ИИ на сервере недействителен. Нужно обновить OPENAI_API_KEY в настройках Railway.';
  }
  return '⚠️ ИИ не смог обработать сообщение. Попробуйте сказать иначе или повторите через минуту.';
}
