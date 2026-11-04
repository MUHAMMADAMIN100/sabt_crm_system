import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Injectable } from '@nestjs/common';

/** Голосовое агентства — не длиннее пяти минут, длиннее обрезаем. */
export const MAX_VOICE_SECONDS = 300;
const TIMEOUT_MS = 60_000;

/**
 * Переводит звук в AAC (m4a): его играет любой браузер, iPhone тоже, и его
 * принимает Instagram. ffmpeg ставится в образ сервера (Dockerfile, apk);
 * локально путь можно задать переменной FFMPEG_PATH.
 * MP4 читается прыжками, поэтому файлы идут через свою временную папку.
 */
@Injectable()
export class AudioConverter {
  private readonly program = process.env.FFMPEG_PATH || 'ffmpeg';

  async toM4a(input: Buffer): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'direct-audio-'));
    try {
      const source = join(dir, 'source');
      const target = join(dir, 'target.m4a');
      await writeFile(source, input);
      await run(this.program, [
        '-hide_banner', '-loglevel', 'error', '-y', '-i', source, '-vn', '-ac', '1',
        '-t', String(MAX_VOICE_SECONDS), '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', target,
      ]);
      return await readFile(target);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

function run(program: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    const errors: Buffer[] = [];
    const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      const reason = Buffer.concat(errors).toString('utf8').trim().slice(0, 300);
      reject(new Error(`ffmpeg stopped with ${code}: ${reason}`));
    });
  });
}
