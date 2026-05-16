type NaiveDateTimeZone = 'utc' | 'asia-shanghai' | 'local';

interface DateTimeParseOptions {
  naiveTimeZone?: NaiveDateTimeZone;
}

const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const BEIJING_OFFSET_MINUTES = 8 * 60;
const NAIVE_DATE_TIME_PATTERN =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/;
const EXPLICIT_TIME_ZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/i;

function hasExplicitTimeZone(value: string): boolean {
  return EXPLICIT_TIME_ZONE_PATTERN.test(value.trim());
}

function parseNaiveDateTime(value: string, zone: NaiveDateTimeZone): Date | null {
  const match = value.trim().match(NAIVE_DATE_TIME_PATTERN);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  const secondNumber = Number(second);

  if (
    !Number.isInteger(yearNumber) ||
    !Number.isInteger(monthNumber) ||
    !Number.isInteger(dayNumber) ||
    !Number.isInteger(hourNumber) ||
    !Number.isInteger(minuteNumber) ||
    !Number.isInteger(secondNumber)
  ) {
    return null;
  }

  if (zone === 'local') {
    const localDate = new Date(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const utcMs = Date.UTC(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, secondNumber);
  const timestamp = zone === 'asia-shanghai' ? utcMs - BEIJING_OFFSET_MINUTES * 60 * 1000 : utcMs;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseDateTime(value: string | null | undefined, options: DateTimeParseOptions = {}): Date | null {
  const text = String(value ?? '').trim();
  if (!text) {
    return null;
  }

  if (/^\d+$/.test(text)) {
    const numeric = Number.parseInt(text, 10);
    if (Number.isFinite(numeric)) {
      return new Date(text.length <= 10 ? numeric * 1000 : numeric);
    }
  }

  if (!hasExplicitTimeZone(text)) {
    const parsedNaive = parseNaiveDateTime(text, options.naiveTimeZone ?? 'utc');
    if (parsedNaive) {
      return parsedNaive;
    }
  }

  const timestamp = Date.parse(text);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

export function formatDateTimeBeijing(
  value: string | null | undefined,
  options: DateTimeParseOptions = {}
): string {
  const date = parseDateTime(value, options);
  if (!date || Number.isNaN(date.getTime())) {
    return value?.trim() || '-';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}`;
}

export function formatTimeBeijing(value: string | null | undefined): string {
  const date = parseDateTime(value);
  if (!date || Number.isNaN(date.getTime())) {
    return '--:--:--';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BEIJING_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}:${values.second}`;
}
