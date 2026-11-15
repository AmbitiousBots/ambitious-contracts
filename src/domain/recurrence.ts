import type { CalendarDate, MonthDayOffset, PositiveCount, RecurrenceUnit } from "./types.ts";
import { isCalendarDate as validCalendarDate, isMonthDayOffset, isPositiveCount } from "./types.ts";

export type CalendarUnit = RecurrenceUnit;

export type ResolvedRecurrence =
  | Readonly<{ kind: "once"; date: CalendarDate }>
  | Readonly<{ kind: "every"; interval: PositiveCount; unit: CalendarUnit; anchor: CalendarDate }>
  | Readonly<{
      kind: "rrule";
      interval: PositiveCount;
      unit: CalendarUnit;
      anchor: CalendarDate;
      monthDay: MonthDayOffset | null;
    }>;

const dayMilliseconds = 86_400_000;

export const isCalendarDate = (value: string): value is CalendarDate => validCalendarDate(value);

function calendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) throw new Error("Use a real calendar date in YYYY-MM-DD format, from year 0001 through 9999.");
  return value;
}

function dateString(date: Date): CalendarDate {
  if (!Number.isFinite(date.getTime())) throw new Error("The recurrence exceeds the supported calendar.");
  const result = date.toISOString().slice(0, 10);
  if (!isCalendarDate(result)) throw new Error("The recurrence exceeds the supported calendar.");
  return result;
}

export function addDays(value: string, days: number): CalendarDate {
  if (!Number.isSafeInteger(days)) throw new Error("The number of days must be a whole safe integer.");
  const start = new Date(`${calendarDate(value)}T00:00:00.000Z`);
  return dateString(new Date(start.getTime() + days * dayMilliseconds));
}

function intervalNumber(value: string): PositiveCount {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error("A recurrence interval must be a positive whole number.");
  const result = Number(value);
  if (!isPositiveCount(result)) throw new Error("A recurrence interval must be a positive safe integer.");
  return result;
}

function calendarUnit(value: string): CalendarUnit {
  switch (value) {
    case "day":
    case "week":
    case "month":
    case "year":
      return value;
    default:
      throw new Error("A recurrence unit must be day, week, month, or year.");
  }
}

function frequencyUnit(value: string | undefined): CalendarUnit {
  switch (value) {
    case "DAILY": return "day";
    case "WEEKLY": return "week";
    case "MONTHLY": return "month";
    case "YEARLY": return "year";
    default: throw new Error("RRULE FREQ must be DAILY, WEEKLY, MONTHLY, or YEARLY.");
  }
}

function parseRule(value: string, anchor: CalendarDate): ResolvedRecurrence {
  const fields = new Map<string, string>();
  for (const part of value.split(";")) {
    const pair = /^([A-Z]+)=([^=]+)$/u.exec(part);
    const key = pair?.[1];
    const field = pair?.[2];
    if (key === undefined || field === undefined || !["FREQ", "INTERVAL", "BYMONTHDAY"].includes(key)) {
      throw new Error("RRULE accepts only FREQ, INTERVAL, and one monthly BYMONTHDAY.");
    }
    if (fields.has(key)) throw new Error("RRULE fields must not be repeated.");
    fields.set(key, field);
  }
  const unit = frequencyUnit(fields.get("FREQ"));
  const interval = intervalNumber(fields.get("INTERVAL") ?? "1");
  const rawMonthDay = fields.get("BYMONTHDAY");
  let monthDay: MonthDayOffset | null = null;
  if (rawMonthDay !== undefined) {
    const parsed = Number(rawMonthDay);
    if (unit !== "month" || !/^-?[1-9]\d?$/u.test(rawMonthDay) || !isMonthDayOffset(parsed)) {
      throw new Error("BYMONTHDAY requires MONTHLY and one integer from -31 through -1 or 1 through 31.");
    }
    monthDay = parsed;
  }
  return { kind: "rrule", interval, unit, anchor, monthDay };
}

export function parseRecurrence(value: string, defaultAnchor: string): ResolvedRecurrence {
  if (value.startsWith("once:")) return { kind: "once", date: calendarDate(value.slice(5)) };
  if (value.startsWith("rrule:")) return parseRule(value.slice(6), calendarDate(defaultAnchor));
  const match = /^every:([1-9]\d*)(day|week|month|year)(?:@(\d{4}-\d{2}-\d{2}))?$/u.exec(value);
  const interval = match?.[1];
  const unit = match?.[2];
  if (interval === undefined || unit === undefined) {
    throw new Error("Use once:YYYY-MM-DD, every:Nday|week|month|year[@YYYY-MM-DD], or rrule:FREQ=... .");
  }
  return {
    kind: "every",
    interval: intervalNumber(interval),
    unit: calendarUnit(unit),
    anchor: calendarDate(match?.[3] ?? defaultAnchor),
  };
}

function dateParts(value: string): Readonly<{ year: number; month: number; day: number }> {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function monthDate(year: number, month: number, day: number): CalendarDate {
  if (year < 1 || year > 9999) throw new Error("The recurrence exceeds the supported calendar.");
  return calendarDate(`${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
}

function occurrence(rule: Exclude<ResolvedRecurrence, { kind: "once" }>, index: number): CalendarDate | null {
  const offset = index * rule.interval;
  if (!Number.isSafeInteger(offset)) throw new Error("The recurrence exceeds the supported calendar.");
  if (rule.unit === "day" || rule.unit === "week") return addDays(rule.anchor, offset * (rule.unit === "week" ? 7 : 1));
  const anchor = dateParts(rule.anchor);
  const totalMonths = anchor.year * 12 + anchor.month - 1 + offset * (rule.unit === "year" ? 12 : 1);
  const year = Math.floor(totalMonths / 12);
  const month = totalMonths % 12 + 1;
  if (year < 1 || year > 9999) throw new Error("The recurrence exceeds the supported calendar.");
  const lastDay = daysInMonth(year, month);
  const requestedDay = rule.kind === "rrule" && rule.monthDay !== null ? rule.monthDay : anchor.day;
  const positiveDay = requestedDay < 0 ? lastDay + requestedDay + 1 : requestedDay;
  if (rule.kind === "rrule" && (positiveDay < 1 || positiveDay > lastDay)) return null;
  return monthDate(year, month, Math.min(positiveDay, lastDay));
}

function approximateIndex(rule: Exclude<ResolvedRecurrence, { kind: "once" }>, date: string): number {
  const anchor = dateParts(rule.anchor);
  const current = dateParts(date);
  if (rule.unit === "month" || rule.unit === "year") {
    const elapsedMonths = (current.year - anchor.year) * 12 + current.month - anchor.month;
    return Math.max(0, Math.floor(elapsedMonths / (rule.interval * (rule.unit === "year" ? 12 : 1))));
  }
  const elapsedDays = (new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${rule.anchor}T00:00:00.000Z`).getTime()) / dayMilliseconds;
  return Math.max(0, Math.floor(elapsedDays / (rule.interval * (rule.unit === "week" ? 7 : 1))));
}

export function firstDue(rule: ResolvedRecurrence): CalendarDate {
  if (rule.kind === "once") return rule.date;
  let index = 0;
  for (;;) {
    const candidate = occurrence(rule, index);
    if (candidate !== null && candidate >= rule.anchor) return candidate;
    index += 1;
  }
}

export function nextDue(rule: ResolvedRecurrence, currentDue: string, exclusiveEnd: string | null = null): CalendarDate | null {
  calendarDate(currentDue);
  if (rule.kind === "once") return null;
  let index = approximateIndex(rule, currentDue);
  const lastIndex = exclusiveEnd === null ? null : approximateIndex(rule, addDays(exclusiveEnd, -1));
  for (;;) {
    if (lastIndex !== null && index > lastIndex) return null;
    const candidate = occurrence(rule, index);
    if (candidate !== null && exclusiveEnd !== null && candidate >= exclusiveEnd) return null;
    if (candidate !== null && candidate > currentDue && candidate >= rule.anchor) return candidate;
    index += 1;
  }
}
