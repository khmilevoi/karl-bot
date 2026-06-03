import type { ServiceIdentifier } from 'inversify';
import type { ConvertedAudioFile } from './AudioConversionService';

export interface AudioTranscriptionService {
  transcribe(file: ConvertedAudioFile): Promise<string>;
}

export const AUDIO_TRANSCRIPTION_SERVICE_ID = Symbol.for(
  'AudioTranscriptionService'
) as ServiceIdentifier<AudioTranscriptionService>;
