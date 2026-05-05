const TZ = "America/New_York";

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Format a UTC Date as a naive ET wall-clock string ("YYYY-MM-DDTHH:mm:ss.sss",
 * no timezone designator). The dashboard's filter envelope expects this format
 * for `minEnqueuedTimestamp` Range values; sending ISO-Z strings produces
 * slightly off counts because of how the backend bucket-aligns timestamps.
 */
export function formatNaiveET(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  // en-CA hour can be "24" at midnight; normalize to "00".
  const hour = get("hour") === "24" ? "00" : get("hour");
  const ms = get("fractionalSecond") ?? "000";
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}.${ms}`;
}

/**
 * Convert "YYYY-MM-DD" + "00:00" or "23:59:59.999" in TZ to a UTC Date.
 * Uses Intl.DateTimeFormat to discover the offset for the given date in TZ.
 */
function tzWallClockToUtc(yyyy: number, mm: number, dd: number, endOfDay: boolean): Date {
  const utcGuess = Date.UTC(yyyy, mm - 1, dd, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  // Find what wall-clock time `utcGuess` represents in TZ, compute the diff, and adjust.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    fractionalSecondDigits: 3, hour12: false,
  });
  const parts = fmt.formatToParts(new Date(utcGuess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const wallUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"), get("fractionalSecond") ?? 0);
  const offsetMs = wallUtc - utcGuess;
  return new Date(utcGuess - offsetMs);
}

function startOfDayET(d: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yyyy = Number(parts.find((p) => p.type === "year")!.value);
  const mm = Number(parts.find((p) => p.type === "month")!.value);
  const dd = Number(parts.find((p) => p.type === "day")!.value);
  return tzWallClockToUtc(yyyy, mm, dd, false);
}

function endOfDayET(d: Date): Date {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = fmt.formatToParts(d);
  const yyyy = Number(parts.find((p) => p.type === "year")!.value);
  const mm = Number(parts.find((p) => p.type === "month")!.value);
  const dd = Number(parts.find((p) => p.type === "day")!.value);
  return tzWallClockToUtc(yyyy, mm, dd, true);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateRange(input?: string): DateRange {
  const now = new Date();
  if (!input || input.trim() === "" || input === "last 7 days") {
    return { start: startOfDayET(new Date(now.getTime() - 7 * 24 * 3600_000)), end: now };
  }
  if (input === "today") return { start: startOfDayET(now), end: now };
  if (input === "yesterday") {
    const y = new Date(now.getTime() - 24 * 3600_000);
    return { start: startOfDayET(y), end: endOfDayET(y) };
  }
  const lastN = input.match(/^last (\d+) days$/);
  if (lastN) {
    const n = Number(lastN[1]);
    if (n < 1 || n > 90) throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
    return { start: startOfDayET(new Date(now.getTime() - n * 24 * 3600_000)), end: now };
  }
  const range = input.match(/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
  if (range) {
    const a = range[1]!;
    const b = range[2]!;
    if (!ISO_DATE.test(a) || !ISO_DATE.test(b)) {
      throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
    }
    const start = tzWallClockToUtc(...a.split("-").map(Number) as [number, number, number], false);
    const end = tzWallClockToUtc(...b.split("-").map(Number) as [number, number, number], true);
    return { start, end };
  }
  throw new Error(`Invalid dateRange: ${input}. Examples: 'last 7 days', 'yesterday', '2026-04-29..2026-05-01'`);
}
