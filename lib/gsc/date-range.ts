import type { GscDateRange } from "./types";

const DATE_LABEL = /^\d{4}-\d{2}-\d{2}$/;

export function shiftDateLabel(label: string, days: number): string {
  if (!DATE_LABEL.test(label)) throw new Error(`Invalid GSC date: ${label}`);
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid GSC date: ${label}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function inclusiveRangeEnding(endDate: string, days: number): GscDateRange {
  if (!Number.isInteger(days) || days < 1) throw new Error("days must be a positive integer");
  return { startDate: shiftDateLabel(endDate, -(days - 1)), endDate };
}

export function previousDateRange(range: GscDateRange): GscDateRange {
  const dayCount = Math.round(
    (toDbDate(range.endDate).getTime() - toDbDate(range.startDate).getTime()) / 86_400_000
  ) + 1;
  return {
    startDate: shiftDateLabel(range.startDate, -dayCount),
    endDate: shiftDateLabel(range.startDate, -1),
  };
}

export function pacificDateLabel(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function toDbDate(label: string): Date {
  if (!DATE_LABEL.test(label)) throw new Error(`Invalid GSC date: ${label}`);
  const date = new Date(`${label}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid GSC date: ${label}`);
  return date;
}
