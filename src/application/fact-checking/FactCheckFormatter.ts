import type { FactCheckFindingWithSources } from '@/domain/entities/FactCheckFindingEntity';
import type { FactCheckStatsPeriod } from '@/domain/repositories/FactCheckRepository';
import type { FactCheckConfig } from '@/application/fact-checking/FactCheckConfig';

export interface FactCheckStatsUserRow {
  authorDisplayName: string;
  confirmed: number;
  uncertain: number;
}

export interface FactCheckStatsCategoryRow {
  category: string;
  confirmed: number;
  uncertain: number;
}

export interface FactCheckStatsReportInput {
  period: FactCheckStatsPeriod;
  fromIso: string;
  toIso: string;
  totalConfirmed: number;
  totalUncertain: number;
  topUsers: FactCheckStatsUserRow[];
  categories: FactCheckStatsCategoryRow[];
}

const MAX_CHUNK_CHARS = 4000;

export function escapeTelegramHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeUrl(url: string): string {
  return url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function formatSources(
  finding: FactCheckFindingWithSources,
  maxDisplayed: number
): string {
  const shown = finding.sources.slice(0, maxDisplayed);
  if (shown.length === 0) return '';
  const links = shown
    .map(
      (s, i) =>
        `<a href="${escapeUrl(s.url)}">${escapeTelegramHtml(s.title || String(i + 1))}</a>`
    )
    .join(', ');
  return `\n<b>Источники:</b> ${links}`;
}

function formatSingleFinding(
  finding: FactCheckFindingWithSources,
  maxDisplayed: number
): string {
  const label =
    finding.status === 'confirmed' ? '🔴 Подтверждено' : '🟡 Вероятно';
  const lines = [
    `${label}`,
    `<blockquote>${escapeTelegramHtml(finding.originalQuote)}</blockquote>`,
    `<b>Верно:</b> ${escapeTelegramHtml(finding.correctedFact)}`,
    `<b>Почему важно:</b> ${escapeTelegramHtml(finding.explanation)}`,
  ];
  const sources = formatSources(finding, maxDisplayed);
  if (sources) lines.push(sources);
  return lines.join('\n');
}

export function formatImmediateFactCheck(
  finding: FactCheckFindingWithSources
): string {
  const lines = [
    '<b>Фактчек</b>: похоже, тут важная фактическая ошибка',
    '',
    `<blockquote>${escapeTelegramHtml(finding.originalQuote)}</blockquote>`,
    '',
    `<b>Верно:</b> ${escapeTelegramHtml(finding.correctedFact)}`,
    `<b>Почему важно:</b> ${escapeTelegramHtml(finding.explanation)}`,
  ];
  const sources = formatSources(finding, 3);
  if (sources) lines.push(sources);
  return lines.join('\n');
}

export function formatHourlyDigest(
  findings: readonly FactCheckFindingWithSources[],
  config: FactCheckConfig
): string[] {
  if (findings.length === 0) return [];

  const confirmed = findings.filter((f) => f.status === 'confirmed');
  const uncertain = findings.filter((f) => f.status === 'uncertain');

  const allParts: string[] = [];

  if (confirmed.length > 0) {
    allParts.push('<b>Фактические ошибки</b>');
    for (const f of confirmed) {
      allParts.push(
        formatSingleFinding(f, config.maxDisplayedSourcesPerFinding)
      );
    }
  }

  if (uncertain.length > 0) {
    allParts.push('<b>Возможные неточности</b>');
    for (const f of uncertain) {
      allParts.push(
        formatSingleFinding(f, config.maxDisplayedSourcesPerFinding)
      );
    }
  }

  // Chunk by count and char budget
  const chunks: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  let countInChunk = 0;

  for (const part of allParts) {
    const partLen = part.length + 2; // +2 for \n\n separator
    const wouldExceedCount =
      !part.startsWith('<b>') &&
      countInChunk >= config.maxFindingsPerDigestMessage;
    const wouldExceedLen = currentLen + partLen > MAX_CHUNK_CHARS;

    if (current.length > 0 && (wouldExceedCount || wouldExceedLen)) {
      chunks.push(current.join('\n\n'));
      current = [];
      currentLen = 0;
      countInChunk = 0;
    }

    current.push(part);
    currentLen += partLen;
    if (!part.startsWith('<b>')) countInChunk++;
  }

  if (current.length > 0) {
    chunks.push(current.join('\n\n'));
  }

  return chunks;
}

export function formatStatsReport(input: FactCheckStatsReportInput): string {
  const periodLabel: Record<FactCheckStatsPeriod, string> = {
    daily: 'за сегодня',
    weekly: 'за неделю',
    monthly: 'за месяц',
  };

  const lines = [
    `<b>Статистика фактчека ${periodLabel[input.period]}</b>`,
    '',
    `Подтверждено ошибок: <b>${input.totalConfirmed}</b>`,
    `Вероятных неточностей: <b>${input.totalUncertain}</b>`,
  ];

  if (input.topUsers.length > 0) {
    lines.push('', '<b>Топ авторов ошибок:</b>');
    for (const u of input.topUsers) {
      lines.push(
        `• ${escapeTelegramHtml(u.authorDisplayName)}: ${u.confirmed} подтв., ${u.uncertain} вероятн.`
      );
    }
  }

  if (input.categories.length > 0) {
    lines.push('', '<b>По категориям:</b>');
    for (const c of input.categories) {
      lines.push(
        `• ${escapeTelegramHtml(c.category)}: ${c.confirmed} / ${c.uncertain}`
      );
    }
  }

  return lines.join('\n');
}
