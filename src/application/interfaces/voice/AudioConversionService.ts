import type { ServiceIdentifier } from 'inversify';
import type { TelegramDownloadedFile } from './TelegramFileDownloadService';

export interface ConvertedAudioFile {
  filename: string;
  mimeType: string;
  buffer: Buffer;
}

export interface AudioConversionService {
  convertForTranscription(
    input: TelegramDownloadedFile
  ): Promise<ConvertedAudioFile>;
}

export const AUDIO_CONVERSION_SERVICE_ID = Symbol.for(
  'AudioConversionService'
) as ServiceIdentifier<AudioConversionService>;
