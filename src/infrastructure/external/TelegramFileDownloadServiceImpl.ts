import { injectable } from 'inversify';
import { Api } from 'grammy';

import type {
  TelegramDownloadedFile,
  TelegramFileDownloadService,
} from '@/application/interfaces/voice/TelegramFileDownloadService';

@injectable()
export class TelegramFileDownloadServiceImpl implements TelegramFileDownloadService {
  private readonly api: Api;

  constructor(private readonly token: string) {
    this.api = new Api(token);
  }

  async download(fileId: string): Promise<TelegramDownloadedFile> {
    const file = await this.api.getFile(fileId);
    const filePath = file.file_path;
    if (filePath == null) {
      throw new Error(`No file_path for fileId: ${fileId}`);
    }

    const url = `https://api.telegram.org/file/bot${this.token}/${filePath}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const filename = filePath.split('/').pop() ?? fileId;
    const ext = filename.split('.').pop() ?? '';
    const mimeType = ext === 'oga' || ext === 'ogg' ? 'audio/ogg' : null;

    return { filename, mimeType, buffer };
  }
}
