import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { injectable } from 'inversify';

import type {
  AudioConversionService,
  ConvertedAudioFile,
} from '@/application/interfaces/voice/AudioConversionService';
import type { TelegramDownloadedFile } from '@/application/interfaces/voice/TelegramFileDownloadService';

const execFileAsync = promisify(execFile);

@injectable()
export class FfmpegAudioConversionService implements AudioConversionService {
  async convertForTranscription(
    input: TelegramDownloadedFile
  ): Promise<ConvertedAudioFile> {
    const tmpDir = tmpdir();
    const id = randomUUID();
    const inputPath = path.join(tmpDir, `voice-in-${id}.ogg`);
    const outputPath = path.join(tmpDir, `voice-out-${id}.webm`);

    try {
      await writeFile(inputPath, input.buffer);
      // Safe argv — NOT a shell string, no injection risk
      await execFileAsync('ffmpeg', [
        '-y',
        '-i',
        inputPath,
        '-c:a',
        'libopus',
        outputPath,
      ]);
      const buffer = await readFile(outputPath);
      return {
        filename: path.basename(outputPath),
        mimeType: 'audio/webm',
        buffer,
      };
    } finally {
      await Promise.allSettled([unlink(inputPath), unlink(outputPath)]);
    }
  }
}
