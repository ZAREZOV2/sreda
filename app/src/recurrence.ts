export type RecurrenceFreq = "daily" | "weekly" | "monthly";

export type Recurrence = {
  freq: RecurrenceFreq;
  interval: number;
};

export function isRecurrence(value: unknown): value is Recurrence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const raw = value as { freq?: unknown; interval?: unknown };
  return (
    (raw.freq === "daily" || raw.freq === "weekly" || raw.freq === "monthly") &&
    typeof raw.interval === "number" &&
    Number.isInteger(raw.interval) &&
    raw.interval >= 1 &&
    raw.interval <= 52
  );
}

/** Следующая дата напоминания в UTC, чтобы расчёт не зависел от пояса машины. */
export function nextOccurrence(fromMs: number, recurrence: Recurrence): number {
  const date = new Date(fromMs);
  const step = recurrence.interval;
  if (recurrence.freq === "daily") date.setUTCDate(date.getUTCDate() + step);
  else if (recurrence.freq === "weekly")
    date.setUTCDate(date.getUTCDate() + step * 7);
  else date.setUTCMonth(date.getUTCMonth() + step);
  return date.getTime();
}

export const recurrenceLabels: Record<RecurrenceFreq, string> = {
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц",
};
