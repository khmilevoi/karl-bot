import { injectable } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { AiGateway } from '@/application/interfaces/ai/AiGateway';
import type { AudioTranscriptionService } from '@/application/interfaces/voice/AudioTranscriptionService';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';

@injectable()
export class OpenAIAudioTranscriptionService implements AudioTranscriptionService {
  constructor(
    private readonly gateway: AiGateway,
    private readonly model: AiModelId
  ) {}

  async transcribe(file: ConvertedAudioFile): Promise<string> {
    return this.gateway.transcribeAudio({
      model: this.model,
      file,
    });
  }
}
