import type { Container } from 'inversify';

import {
  ENV_SERVICE_ID,
  type EnvService,
} from '@/application/interfaces/env/EnvService';
import {
  VOICE_CONFIG_ID,
  type VoiceConfig,
} from '@/application/voice/VoiceConfig';
import {
  TELEGRAM_FILE_DOWNLOAD_SERVICE_ID,
  type TelegramFileDownloadService,
} from '@/application/interfaces/voice/TelegramFileDownloadService';
import {
  AUDIO_CONVERSION_SERVICE_ID,
  type AudioConversionService,
} from '@/application/interfaces/voice/AudioConversionService';
import {
  AUDIO_TRANSCRIPTION_SERVICE_ID,
  type AudioTranscriptionService,
} from '@/application/interfaces/voice/AudioTranscriptionService';
import { TelegramFileDownloadServiceImpl } from '@/infrastructure/external/TelegramFileDownloadServiceImpl';
import { FfmpegAudioConversionService } from '@/infrastructure/external/FfmpegAudioConversionService';
import { OpenAIAudioTranscriptionService } from '@/infrastructure/external/OpenAIAudioTranscriptionService';

export const registerVoiceWorker = (container: Container): void => {
  const envService = container.get<EnvService>(ENV_SERVICE_ID);
  const voiceConfig = container.get<VoiceConfig>(VOICE_CONFIG_ID);

  container
    .bind<TelegramFileDownloadService>(TELEGRAM_FILE_DOWNLOAD_SERVICE_ID)
    .toDynamicValue(
      () => new TelegramFileDownloadServiceImpl(envService.env.BOT_TOKEN)
    )
    .inSingletonScope();

  container
    .bind<AudioConversionService>(AUDIO_CONVERSION_SERVICE_ID)
    .to(FfmpegAudioConversionService)
    .inSingletonScope();

  container
    .bind<AudioTranscriptionService>(AUDIO_TRANSCRIPTION_SERVICE_ID)
    .toDynamicValue(
      () =>
        new OpenAIAudioTranscriptionService(
          envService.env.OPENAI_KEY,
          voiceConfig.transcriptionModel
        )
    )
    .inSingletonScope();
};
