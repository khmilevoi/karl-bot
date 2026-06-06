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

export interface FactCheckDigestChunk {
  text: string;
  findingIds: number[];
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
  return formatHourlyDigestChunks(findings, config).map((c) => c.text);
}

export function formatHourlyDigestChunks(
  findings: readonly FactCheckFindingWithSources[],
  config: FactCheckConfig
): FactCheckDigestChunk[] {
  if (findings.length === 0) return [];

  const confirmed = findings.filter((f) => f.status === 'confirmed');
  const uncertain = findings.filter((f) => f.status === 'uncertain');

  const allParts: { text: string; findingId: number | null }[] = [];

  if (confirmed.length > 0) {
    allParts.push({ text: '<b>Фактические ошибки</b>', findingId: null });
    for (const f of confirmed) {
      allParts.push({
        text: formatSingleFinding(f, config.maxDisplayedSourcesPerFinding),
        findingId: f.id,
      });
    }
  }

  if (uncertain.length > 0) {
    allParts.push({ text: '<b>Возможные неточности</b>', findingId: null });
    for (const f of uncertain) {
      allParts.push({
        text: formatSingleFinding(f, config.maxDisplayedSourcesPerFinding),
        findingId: f.id,
      });
    }
  }

  // Chunk by count and char budget
  const chunks: FactCheckDigestChunk[] = [];
  let current: { text: string; findingId: number | null }[] = [];
  let currentLen = 0;
  let countInChunk = 0;

  for (const part of allParts) {
    const partLen = part.text.length + 2; // +2 for \n\n separator
    const wouldExceedCount =
      part.findingId != null &&
      countInChunk >= config.maxFindingsPerDigestMessage;
    const wouldExceedLen = currentLen + partLen > MAX_CHUNK_CHARS;

    if (current.length > 0 && (wouldExceedCount || wouldExceedLen)) {
      chunks.push({
        text: current.map((p) => p.text).join('\n\n'),
        findingIds: current
          .map((p) => p.findingId)
          .filter((id): id is number => id != null),
      });
      current = [];
      currentLen = 0;
      countInChunk = 0;
    }

    current.push(part);
    currentLen += partLen;
    if (part.findingId != null) countInChunk++;
  }

  if (current.length > 0) {
    chunks.push({
      text: current.map((p) => p.text).join('\n\n'),
      findingIds: current
        .map((p) => p.findingId)
        .filter((id): id is number => id != null),
    });
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
