// Triggers a bot job via the running HTTP server.
//
// Usage:
//   node scripts/trigger-job.mjs <job> --chat-id <n>
//   node scripts/trigger-job.mjs <job> --all
//   node scripts/trigger-job.mjs fact-check-stats --period weekly --all
//
// Base URL: $JOBS_BASE_URL, else http://localhost:$PORT (PORT defaults to 3000).
import { pathToFileURL } from 'node:url';

const JOBS = ['state-evolution', 'fact-check', 'fact-check-stats'];
const PERIODS = ['daily', 'weekly', 'monthly'];

export function parseArgs(argv) {
  const [job, ...rest] = argv;
  if (!job || !JOBS.includes(job)) {
    return {
      ok: false,
      error: `Unknown job "${job ?? ''}". Expected one of: ${JOBS.join(', ')}`,
    };
  }

  let chatId = null;
  let all = false;
  let period = null;

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--all') {
      all = true;
    } else if (arg === '--chat-id') {
      chatId = rest[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--chat-id=')) {
      chatId = arg.slice('--chat-id='.length);
    } else if (arg === '--period') {
      period = rest[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith('--period=')) {
      period = arg.slice('--period='.length);
    } else {
      return { ok: false, error: `Unknown argument: ${arg}` };
    }
  }

  if (all === (chatId !== null)) {
    return {
      ok: false,
      error: 'Specify exactly one of --chat-id <n> or --all',
    };
  }
  if (
    job === 'fact-check-stats' &&
    (period === null || !PERIODS.includes(period))
  ) {
    return {
      ok: false,
      error: `fact-check-stats requires --period <${PERIODS.join('|')}>`,
    };
  }

  return { ok: true, job, all, chatId, period };
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.error}\n`);
    process.exitCode = 1;
    return;
  }

  const base =
    process.env.JOBS_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const path = parsed.all ? `/jobs/${parsed.job}/all` : `/jobs/${parsed.job}`;
  const body = {};
  if (!parsed.all) body.chatId = Number(parsed.chatId);
  if (parsed.period) body.period = parsed.period;

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  process.stdout.write(`${await res.text()}\n`);
  process.exitCode = res.ok ? 0 : 1;
}

const isMain =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? String(error)}\n`);
    process.exitCode = 1;
  });
}
