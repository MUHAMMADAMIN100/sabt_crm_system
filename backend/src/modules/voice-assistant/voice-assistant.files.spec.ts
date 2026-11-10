import { runAgent } from './agent';
import { VoiceAssistantService } from './voice-assistant.service';

jest.mock('./agent', () => ({ runAgent: jest.fn(), runPending: jest.fn() }));
jest.mock('./prompt', () => ({
  buildSnapshot: jest.fn(async () => ({ text: '', speechHint: '' })),
  systemPrompt: jest.fn(() => 'system'),
}));

const CHAT = 777;
const USER = { id: 'u1', role: 'smm_specialist', secondaryRole: null, extraPermissions: [], deniedPermissions: [], isActive: true, isBlocked: false };

function makeService() {
  const sent: string[] = [];
  const telegram: any = {
    registerAssistant: jest.fn(),
    resolveUserIdByChat: async () => 'u1',
    sendMessage: async (_c: number, t: string) => { sent.push(t); },
    sendChatAction: async () => undefined,
    downloadFile: jest.fn(async () => Buffer.from('x')),
    sendToUser: async () => undefined,
  };
  const userRepo: any = { findOne: async () => USER };
  const svc = new VoiceAssistantService(userRepo, telegram, { sign: () => 't' } as any, {} as any);
  return { svc, sent };
}

const FILE = { fileId: 'F1', name: 'photo.jpg', mime: 'image/jpeg', kind: 'photo' as const };

describe('файлы в чате помощника', () => {
  beforeEach(() => (runAgent as jest.Mock).mockReset());

  it('без подписи — спрашивает, к чему приложить, и ждёт; ИИ не вызывается', async () => {
    const { svc, sent } = makeService();
    await svc.handleFile(CHAT, FILE, '');
    expect(sent[0]).toContain('К чему приложить?');
    expect(runAgent).not.toHaveBeenCalled();
    expect(svc._state.pendingFiles.get(CHAT)?.file).toEqual(FILE);
  });

  it('следующий текст разбирается с этим файлом: ctx.file есть, инструменты файлов открыты', async () => {
    const { svc } = makeService();
    await svc.handleFile(CHAT, FILE, '');
    (runAgent as jest.Mock).mockResolvedValue({ type: 'answer', text: 'ок', done: [], buttons: [] });
    await svc.handleText(CHAT, 'приложи к задаче Макет');
    const arg = (runAgent as jest.Mock).mock.calls[0][0];
    expect(arg.ctx.file.name).toBe('photo.jpg');
    expect(await arg.ctx.file.download()).toEqual(Buffer.from('x'));
    expect(arg.tools.map((t: any) => t.name)).toEqual(expect.arrayContaining(['attach_task_result']));
    expect(arg.userText).toContain('приложи к задаче Макет');
    expect(arg.userText).toContain('прислал фото');
  });

  it('с подписью — подпись сразу разбирается как просьба', async () => {
    const { svc } = makeService();
    (runAgent as jest.Mock).mockResolvedValue({ type: 'answer', text: 'ок', done: [], buttons: [] });
    await svc.handleFile(CHAT, FILE, 'результат по задаче Макет');
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect((runAgent as jest.Mock).mock.calls[0][0].ctx.file.kind).toBe('photo');
  });

  it('после успешного приложения файл забывается; без файла инструменты скрыты', async () => {
    const { svc } = makeService();
    await svc.handleFile(CHAT, FILE, '');
    (runAgent as jest.Mock).mockResolvedValue({
      type: 'answer', text: '', buttons: [],
      done: [{ tool: 'attach_task_result', outcome: { summary: 'готово' } }],
    });
    await svc.handleText(CHAT, 'приложи к задаче Макет');
    expect(svc._state.pendingFiles.has(CHAT)).toBe(false);

    (runAgent as jest.Mock).mockResolvedValue({ type: 'answer', text: 'ок', done: [], buttons: [] });
    await svc.handleText(CHAT, 'какие задачи на завтра');
    const arg = (runAgent as jest.Mock).mock.calls[1][0];
    expect(arg.ctx.file).toBeUndefined();
    expect(arg.tools.map((t: any) => t.name)).not.toContain('attach_task_result');
  });

  it('файл старше 15 минут не используется', async () => {
    const { svc } = makeService();
    await svc.handleFile(CHAT, FILE, '');
    svc._state.pendingFiles.get(CHAT)!.at = Date.now() - 16 * 60_000;
    (runAgent as jest.Mock).mockResolvedValue({ type: 'answer', text: 'ок', done: [], buttons: [] });
    await svc.handleText(CHAT, 'приложи к задаче Макет');
    expect((runAgent as jest.Mock).mock.calls[0][0].ctx.file).toBeUndefined();
  });
});
