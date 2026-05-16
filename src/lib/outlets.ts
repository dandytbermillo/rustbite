export const DEFAULT_SITE_ID = "site";
export const DEFAULT_OUTLET_ID = "cafeteria";
export const DEFAULT_CAFETERIA_OUTLET_ID = "cafeteria";
export const DEFAULT_SITE_TIMEZONE = "America/Edmonton";
export const DEFAULT_BUSINESS_DAY_ROLLOVER_HOUR = 4;

export function getBusinessDate(
  at: Date,
  options?: {
    timeZone?: string;
    rolloverHour?: number;
  }
): Date {
  const timeZone = options?.timeZone ?? DEFAULT_SITE_TIMEZONE;
  const rolloverHour =
    options?.rolloverHour ?? DEFAULT_BUSINESS_DAY_ROLLOVER_HOUR;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  })
    .formatToParts(at)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== "literal") acc[part.type] = part.value;
      return acc;
    }, {});

  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  const localMidnightUtc = new Date(Date.UTC(year, month - 1, day));

  if (hour < rolloverHour) {
    localMidnightUtc.setUTCDate(localMidnightUtc.getUTCDate() - 1);
  }

  return localMidnightUtc;
}

export function formatDisplayOrderNumber(
  orderPrefix: string,
  sequenceNumber: number
): string {
  return `${orderPrefix}-${String(sequenceNumber).padStart(3, "0")}`;
}
