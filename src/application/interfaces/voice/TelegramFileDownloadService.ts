import type { ServiceIdentifier } from 'inversify';

export interface TelegramDownloadedFile {
  filename: string;
  mimeType: string | null;
  buffer: Buffer;
}

export interface TelegramFileDownloadService {
  download(fileId: string): Promise<TelegramDownloadedFile>;
}

export const TELEGRAM_FILE_DOWNLOAD_SERVICE_ID = Symbol.for(
  'TelegramFileDownloadService'
) as ServiceIdentifier<TelegramFileDownloadService>;
