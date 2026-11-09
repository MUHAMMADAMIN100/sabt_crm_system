import { AiProviderError, chatProviders, ChatProvider, classifyAiFailure, ProviderId } from './providers';

/** Сообщения и инструменты — в формате OpenAI Chat Completions. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolSpec {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, any> };
}

export interface ChatReply {
  content: string | null;
  toolCalls: ToolCall[];
  provider: ProviderId;
}

const TIMEOUT_MS = 60_000;

/**
 * Один шаг разговора с ИИ. Идём по поставщикам по порядку; preferred — тот,
 * что уже ответил в этом разговоре (чтобы шаги одной команды шли через
 * одного поставщика, пока он жив).
 */
export async function chatStep(
  messages: ChatMessage[],
  tools: ToolSpec[],
  preferred?: ProviderId,
): Promise<ChatReply> {
  const all = chatProviders();
  const ordered = preferred
    ? [...all.filter((p) => p.id === preferred), ...all.filter((p) => p.id !== preferred)]
    : all;
  const errors: AiProviderError[] = [];
  for (const p of ordered) {
    try {
      return await callProvider(p, messages, tools);
    } catch (e: any) {
      errors.push(e instanceof AiProviderError ? e : new AiProviderError(p.id, 'unknown', null, String(e?.message || e)));
    }
  }
  throw new AllChatFailed(errors);
}

export class AllChatFailed extends Error {
  constructor(readonly errors: AiProviderError[]) {
    super(errors.map((e) => e.message).join(' | ') || 'нет поставщиков ИИ');
  }
}

async function callProvider(p: ChatProvider, messages: ChatMessage[], tools: ToolSpec[]): Promise<ChatReply> {
  const body: Record<string, any> = {
    model: p.model,
    messages,
  };
  if (tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (p.id === 'openai') {
    body.max_completion_tokens = 4000;
    if (p.reasoning) body.reasoning_effort = p.reasoning;
    else body.temperature = 0.1;
  } else if (p.id === 'groq') {
    body.max_completion_tokens = 4000;
    if (p.reasoning) body.reasoning_effort = p.reasoning;
    body.temperature = 0.1;
  } else {
    body.temperature = 0.1;
  }

  let res: Response;
  try {
    res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e: any) {
    throw new AiProviderError(p.id, 'network', null, String(e?.message || e));
  }
  const raw = await res.text();
  if (!res.ok) throw new AiProviderError(p.id, classifyAiFailure(res.status, raw), res.status, raw.slice(0, 400));
  let json: any;
  try { json = JSON.parse(raw); } catch {
    throw new AiProviderError(p.id, 'unknown', res.status, `неожиданный ответ: ${raw.slice(0, 120)}`);
  }
  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new AiProviderError(p.id, 'unknown', res.status, 'пустой ответ');
  const toolCalls: ToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls
      .filter((c: any) => c?.function?.name)
      .map((c: any, i: number) => ({
        id: String(c.id || `call_${Date.now().toString(36)}_${i}`),
        type: 'function' as const,
        function: { name: String(c.function.name), arguments: String(c.function.arguments || '{}') },
      }))
    : [];
  return { content: typeof msg.content === 'string' ? msg.content : null, toolCalls, provider: p.id };
}
