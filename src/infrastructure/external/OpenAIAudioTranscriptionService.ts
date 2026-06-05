import { injectable } from 'inversify';

import type { AiModelId } from '@/application/interfaces/ai/AiModelId';
import type { OpenAiGateway } from '@/application/interfaces/ai/OpenAiGateway';
import type { AudioTranscriptionService } from '@/application/interfaces/voice/AudioTranscriptionService';
import type { ConvertedAudioFile } from '@/application/interfaces/voice/AudioConversionService';

@injectable()
export class OpenAIAudioTranscriptionService implements AudioTranscriptionService {
  constructor(
    private readonly gateway: OpenAiGateway,
    private readonly model: AiModelId
  ) {}

  async transcribe(file: ConvertedAudioFile): Promise<string> {
    return this.gateway.transcribeAudio({
      model: this.model,
      file,
    });
  }
}
