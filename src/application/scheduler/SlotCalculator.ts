import type { DueSlot } from '@/domain/scheduler/ScheduledJobTypes';

interface CivilParts {
  year: number;
  month: number;
  day: number;
  hour: number;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function pad4(value: number): string {
  return value.toString().padStart(4, '0');
}

function partsInZone(date: Date, timeZone: string): CivilParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  });
  const lookup = new Map(
    fmt.formatToParts(date).map((part) => [part.type, part.value])
  );
  const rawHour = lookup.get('hour') ?? '0';
  return {
    year: Number(lookup.get('year')),
    month: Number(lookup.get('month')),
    day: Number(lookup.get('day')),
    hour: rawHour === '24' ? 0 : Number(rawHour),
  };
}

function isoWeek(p: CivilParts): { isoYear: number; week: number } {
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  const msPerWeek = 7 * 24 * 60 * 60 * 1000;
  const week =
    1 + Math.round((date.getTime() - firstThursday.getTime()) / msPerWeek);
  return { isoYear, week };
}

export class SlotCalculator {
  constructor(private readonly timezone: string) {}

  private hourBucket(date: Date): string {
    const p = partsInZone(date, this.timezone);
    return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}`;
  }

  hourlyFactCheck(date: Date): DueSlot {
    return {
      jobName: 'fact-check',
      slotKey: `fact-check:${this.hourBucket(date)}`,
      payloadJson: '{}',
      runAfter: date.toISOString(),
    };
  }

  stateEvolution(date: Date): DueSlot {
    return {
      jobName: 'state-evolution',
      slotKey: `state-evolution:${this.hourBucket(date)}`,
      payloadJson: '{}',
      runAfter: date.toISOString(),
    };
  }

  dailyStats(date: Date): DueSlot {
    const p = partsInZone(date, this.timezone);
    const day = `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`;
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:daily:${day}`,
      payloadJson: '{"period":"daily"}',
      runAfter: date.toISOString(),
    };
  }

  weeklyStats(date: Date): DueSlot {
    const { isoYear, week } = isoWeek(partsInZone(date, this.timezone));
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:weekly:${pad4(isoYear)}-W${pad2(week)}`,
      payloadJson: '{"period":"weekly"}',
      runAfter: date.toISOString(),
    };
  }

  monthlyStats(date: Date): DueSlot {
    const p = partsInZone(date, this.timezone);
    return {
      jobName: 'fact-check-stats',
      slotKey: `fact-check-stats:monthly:${pad4(p.year)}-${pad2(p.month)}`,
      payloadJson: '{"period":"monthly"}',
      runAfter: date.toISOString(),
    };
  }
}
