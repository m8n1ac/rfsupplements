// Period resolution. The timezone is always an argument, never a constant:
// the UI passes STORE_TZ for business-correct reporting, and the Gate 4
// verification passes UTC so it can be compared with WooCommerce Analytics,
// which groups by the WordPress site timezone (Gate 0, A2).

export const PERIOD_KEYS = ["today", "7d", "30d", "mtd", "qtd", "ytd", "custom"] as const;
export type PeriodKey = (typeof PERIOD_KEYS)[number];

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  mtd: "Month to date",
  qtd: "Quarter to date",
  ytd: "Year to date",
  custom: "Custom",
};

export type Period = {
  key: PeriodKey;
  /** Inclusive start instant, in UTC. */
  from: Date;
  /** Exclusive end instant, in UTC. */
  to: Date;
  label: string;
};

export type Range = { from: Date; to: Date };

type Parts = { year: number; month: number; day: number };

const partsCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partsCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    partsCache.set(timeZone, formatter);
  }
  return formatter;
}

function readParts(instant: Date, timeZone: string): Parts & { hour: number; minute: number; second: number } {
  const parts = partsFormatter(timeZone).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
    second: value("second"),
  };
}

/** The zone's offset from UTC, in milliseconds, at a given instant. */
function offsetAt(instant: Date, timeZone: string): number {
  const local = readParts(instant, timeZone);
  const asUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The UTC instant of local midnight on a given calendar date in a zone.
 *
 * Two passes, because the offset itself depends on the instant: the first guess
 * uses the offset at the naive time, the second corrects it. That is what makes
 * this right across a DST boundary, which California has twice a year.
 */
export function zonedStartOfDay(date: Parts, timeZone: string): Date {
  const naive = Date.UTC(date.year, date.month - 1, date.day, 0, 0, 0);
  const firstGuess = new Date(naive - offsetAt(new Date(naive), timeZone));
  return new Date(naive - offsetAt(firstGuess, timeZone));
}

export function todayParts(timeZone: string, now: Date): Parts {
  const { year, month, day } = readParts(now, timeZone);
  return { year, month, day };
}

function addDays(date: Parts, days: number): Parts {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export function resolvePeriod(
  key: PeriodKey,
  timeZone: string,
  now: Date,
  custom?: { from?: string; to?: string },
): Period {
  const today = todayParts(timeZone, now);
  const startOfToday = zonedStartOfDay(today, timeZone);
  const startOfTomorrow = zonedStartOfDay(addDays(today, 1), timeZone);

  switch (key) {
    case "today":
      return { key, from: startOfToday, to: startOfTomorrow, label: PERIOD_LABELS.today };

    // "7 days" means the last 7 whole days including today, matching how the
    // store owner reads it, not a rolling 168 hours.
    case "7d":
      return {
        key,
        from: zonedStartOfDay(addDays(today, -6), timeZone),
        to: startOfTomorrow,
        label: PERIOD_LABELS["7d"],
      };
    case "30d":
      return {
        key,
        from: zonedStartOfDay(addDays(today, -29), timeZone),
        to: startOfTomorrow,
        label: PERIOD_LABELS["30d"],
      };
    case "mtd":
      return {
        key,
        from: zonedStartOfDay({ ...today, day: 1 }, timeZone),
        to: startOfTomorrow,
        label: PERIOD_LABELS.mtd,
      };
    case "qtd": {
      const quarterStartMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      return {
        key,
        from: zonedStartOfDay({ ...today, month: quarterStartMonth, day: 1 }, timeZone),
        to: startOfTomorrow,
        label: PERIOD_LABELS.qtd,
      };
    }
    case "ytd":
      return {
        key,
        from: zonedStartOfDay({ ...today, month: 1, day: 1 }, timeZone),
        to: startOfTomorrow,
        label: PERIOD_LABELS.ytd,
      };
    case "custom": {
      const from = parseDate(custom?.from) ?? today;
      const to = parseDate(custom?.to) ?? today;
      return {
        key,
        from: zonedStartOfDay(from, timeZone),
        // The end date is inclusive of its whole day.
        to: zonedStartOfDay(addDays(to, 1), timeZone),
        label: `${format(from)} to ${format(to)}`,
      };
    }
  }
}

/** The equally long window immediately before this one. */
export function priorPeriod(period: Period): Range {
  const length = period.to.getTime() - period.from.getTime();
  return { from: new Date(period.from.getTime() - length), to: period.from };
}

function parseDate(value: string | undefined): Parts | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function format(date: Parts): string {
  return `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export function isPeriodKey(value: string | undefined): value is PeriodKey {
  return PERIOD_KEYS.includes(value as PeriodKey);
}
