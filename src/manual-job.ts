import {
  MANUAL_JOB_RUNNER_ID,
  type ManualJobName,
  type ManualJobRunner,
  type ManualJobRunInput,
} from './application/interfaces/scheduler/ManualJobRunner';
import { container } from './container';

interface ParseSuccess extends ManualJobRunInput {
  ok: true;
}

interface ParseFailure {
  ok: false;
  error: string;
}

type ParseResult = ParseSuccess | ParseFailure;

const usage = [
  'Usage:',
  '  node dist/manual-job.js state-evolution --chat-id <chatId>',
  '  node dist/manual-job.js topic-of-day --chat-id <chatId>',
].join('\n');

function isManualJobName(value: string): value is ManualJobName {
  return value === 'state-evolution' || value === 'topic-of-day';
}

export function parseManualJobArgs(args: readonly string[]): ParseResult {
  const [jobArg, ...rest] = args;
  if (!jobArg || !isManualJobName(jobArg)) {
    return { ok: false, error: `Unknown job.\n${usage}` };
  }

  let chatIdText: string | null = null;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--chat-id') {
      chatIdText = rest[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (arg.startsWith('--chat-id=')) {
      chatIdText = arg.slice('--chat-id='.length);
      continue;
    }
    return { ok: false, error: `Unknown argument: ${arg}\n${usage}` };
  }

  if (chatIdText === null || chatIdText.trim() === '') {
    return { ok: false, error: `Missing --chat-id.\n${usage}` };
  }

  const chatId = Number(chatIdText);
  if (!Number.isInteger(chatId)) {
    return { ok: false, error: `Invalid chat id: ${chatIdText}\n${usage}` };
  }

  return { ok: true, job: jobArg, chatId };
}

function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

export async function runManualJobCli(
  args: readonly string[]
): Promise<number> {
  const parsed = parseManualJobArgs(args);
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    return 1;
  }

  log(`[manual-job] starting "${parsed.job}" for chatId ${parsed.chatId}`);

  let runner: ManualJobRunner;
  try {
    runner = container.get<ManualJobRunner>(MANUAL_JOB_RUNNER_ID);
  } catch (error) {
    log(
      `[manual-job] container init failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return 1;
  }

  const result = await runner.run({
    job: parsed.job,
    chatId: parsed.chatId,
  });
  log(`[manual-job] done — outcome: ${result.outcome}`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return 0;
}

void runManualJobCli(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = 1;
  });
