import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AiGateway } from '../src/application/interfaces/ai/AiGateway';
import type { TelegramDownloadedFile } from '../src/application/interfaces/voice/TelegramFileDownloadService';

// --- Telegram file download ---
describe('TelegramFileDownloadServiceImpl', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('downloads a file by fileId using bot token', async () => {
    const mockBuffer = Buffer.from('audio-data');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: vi.fn().mockResolvedValue(mockBuffer.buffer),
    });
    vi.stubGlobal('fetch', mockFetch);

    vi.mock('grammy', () => ({
      Api: class {
        getFile = vi.fn().mockResolvedValue({
          file_path: 'voice/file_123.oga',
        });
      },
    }));

    const { TelegramFileDownloadServiceImpl } =
      await import('../src/infrastructure/external/TelegramFileDownloadServiceImpl');
    const service = new TelegramFileDownloadServiceImpl('test-token');

    const result = await service.download('file-id-123');

    expect(result.buffer.length).toBeGreaterThan(0);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('test-token')
    );
  });
});

// --- ffmpeg conversion ---
// Use vi.hoisted so the mock function reference is available inside vi.mock factory
const { mockExecFile, mockWriteFile, mockReadFile, mockUnlink } = vi.hoisted(
  () => ({
    mockExecFile: vi.fn().mockImplementation((...callArgs: unknown[]) => {
      // promisify appends the callback as the last argument
      const callback = callArgs[callArgs.length - 1] as (
        err: null,
        stdout: string,
        stderr: string
      ) => void;
      callback(null, '', '');
    }),
    mockWriteFile: vi.fn().mockResolvedValue(undefined),
    mockReadFile: vi.fn().mockResolvedValue(Buffer.from('converted-audio')),
    mockUnlink: vi.fn().mockResolvedValue(undefined),
  })
);

vi.mock('node:child_process', () => ({ execFile: mockExecFile }));
vi.mock('node:fs/promises', () => ({
  writeFile: mockWriteFile,
  readFile: mockReadFile,
  unlink: mockUnlink,
}));

describe('FfmpegAudioConversionService', () => {
  it('calls ffmpeg with argv (not shell string) and returns converted buffer', async () => {
    const { FfmpegAudioConversionService } =
      await import('../src/infrastructure/external/FfmpegAudioConversionService');
    const service = new FfmpegAudioConversionService();
    const input: TelegramDownloadedFile = {
      filename: 'voice.ogg',
      mimeType: 'audio/ogg',
      buffer: Buffer.from('raw-audio'),
    };

    const result = await service.convertForTranscription(input);

    expect(result.buffer).toBeInstanceOf(Buffer);
    expect(result.mimeType).toBe('audio/webm');
    // Must NOT use shell string — execFile called with array args
    expect(mockExecFile).toHaveBeenCalled();
    const args = mockExecFile.mock.calls[0][1];
    expect(Array.isArray(args)).toBe(true);
  });
});

describe('OpenAIAudioTranscriptionService', () => {
  it('delegates audio transcription to the AI gateway', async () => {
    const { OpenAIAudioTranscriptionService } =
      await import('../src/infrastructure/external/OpenAIAudioTranscriptionService');
    const transcribeAudio = vi.fn().mockResolvedValue('hello world');
    const gateway = {
      transcribeAudio,
    } as unknown as AiGateway;
    const service = new OpenAIAudioTranscriptionService(
      gateway,
      'gpt-4o-mini-transcribe'
    );
    const file = {
      filename: 'voice.webm',
      mimeType: 'audio/webm',
      buffer: Buffer.from('audio'),
    };

    const result = await service.transcribe(file);

    expect(result).toBe('hello world');
    expect(transcribeAudio).toHaveBeenCalledWith({
      model: 'gpt-4o-mini-transcribe',
      file,
    });
  });
});
