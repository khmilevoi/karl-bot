import { injectable } from 'inversify';
import OpenAI from 'openai';

import type { AudioTranscriptionService } from '@/application/interfaces/voice/AudioTranscriptionService';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';

@injectable()
export class OpenAIAudioTranscriptionService implements AudioTranscriptionService {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async transcribe(file: ConvertedAudioFile): Promise<string> {
    const arrayBuffer = file.buffer.buffer.slice(
      file.buffer.byteOffset,
      file.buffer.byteOffset + file.buffer.byteLength
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: file.mimeType });
    const fileObj = new File([blob], file.filename, { type: file.mimeType });

    const result = await this.client.audio.transcriptions.create({
      model: this.model,
      file: fileObj,
    });

    return result.text.trim();
  }
}
