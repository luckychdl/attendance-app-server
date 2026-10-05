/**
 * 날짜·시각 유틸.
 *
 * 앱은 기기 로컬 타임존으로 계산하지만 서버는 어디서 돌지 모르므로,
 * 근무일과 시각은 항상 설정된 타임존(APP_TIMEZONE)으로 풀어서 다룬다.
 * 날짜는 YYYY-MM-DD 문자열(dateKey), 시각은 자정 기준 분으로 주고받는다.
 */

const DAY_MS = 86_400_000;

export type Zoned = {
  dateKey: string;
  /** 자정 기준 분. 초는 소수로 남긴다. */
  minutes: number;
};

export type Clock = ReturnType<typeof createClock>;

export function createClock(timeZone: string, now: () => Date = () => new Date()) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  function zoned(value: Date | string): Zoned {
    const date = typeof value === 'string' ? new Date(value) : value;
    const parts: Record<string, string> = {};
    for (const part of format.formatToParts(date)) parts[part.type] = part.value;
    return {
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: Number(parts.hour) * 60 + Number(parts.minute) + Number(parts.second) / 60,
    };
  }

  /** workDate 자정부터 흐른 분. 자정을 넘긴 시각은 1440 을 넘는다. */
  function minutesSince(workDate: string, value: Date | string) {
    const at = zoned(value);
    return dayDiff(workDate, at.dateKey) * 1440 + at.minutes;
  }

  /** 타임존 기준 dateKey 의 minutes 분에 해당하는 실제 시각 */
  function instantAt(dateKey: string, minutes: number) {
    const wanted = toUtc(dateKey).getTime() + minutes * 60_000;
    const guess = new Date(wanted);
    const offset = (minutesSince(dateKey, guess) - minutes) * 60_000;
    return new Date(wanted - offset);
  }

  return {
    now,
    zoned,
    minutesSince,
    instantAt,
    /** 오늘 날짜 (YYYY-MM-DD) */
    today: () => zoned(now()).dateKey,
  };
}

// ─── dateKey 계산 (타임존과 무관) ─────────────────────────────

function toUtc(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** 실제로 있는 날짜인지 (2026-02-30 같은 값을 거른다) */
export function isDateKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

export function isMonthKey(value: string) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addDays(dateKey: string, days: number) {
  return fromUtc(new Date(toUtc(dateKey).getTime() + days * DAY_MS));
}

/** from 에서 to 까지 며칠인지 */
export function dayDiff(from: string, to: string) {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / DAY_MS);
}

export function isWeekend(dateKey: string) {
  const day = toUtc(dateKey).getUTCDay();
  return day === 0 || day === 6;
}

/** startDate ~ endDate 사이의 날짜 키. 양 끝 포함 */
export function datesInRange(startDate: string, endDate: string) {
  const dates: string[] = [];
  for (let key = startDate; key <= endDate; key = addDays(key, 1)) dates.push(key);
  return dates;
}

/** 해당 월의 1일 ~ 말일 */
export function monthRange(monthKey: string) {
  const [year, month] = monthKey.split('-').map(Number);
  return {
    from: `${monthKey}-01`,
    to: fromUtc(new Date(Date.UTC(year, month, 0))),
  };
}

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** 자정 기준 분 → 14:00 */
export function formatClock(minutes: number) {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** 14:00 → 자정 기준 분 */
export function parseClock(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesBetween(from: Date | string, to: Date | string) {
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}
