export const DEFAULT_DEAL_START_TIME = "00:00";
export const DEFAULT_DEAL_EXPIRATION_TIME = "23:59";
export const DEFAULT_DEAL_EXPIRATION_TIME_LABEL = "11:59 PM";
export const DEAL_SCHEDULE_INVALID_RANGE_MESSAGE =
  "End time must be after start time.";

export type DealScheduleWindow = {
  startsAt: string;
  expiresAt: string;
};

export type DealScheduleStatus =
  | "missing"
  | "invalid"
  | "scheduled"
  | "active"
  | "expired";

export type DealScheduleValidation =
  | {
      ok: true;
      status: Exclude<DealScheduleStatus, "missing" | "invalid">;
      startsAt: Date | null;
      expiresAt: Date;
    }
  | {
      ok: false;
      status: "missing" | "invalid";
      message: string;
    };

type DateInputOptions = {
  legacyEndMidnightAsPreviousDay?: boolean;
};

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function localDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function parseDateInputValue(value: string):
  | { year: number; month: number; day: number }
  | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

function parseTimeInputValue(value: string):
  | { hour: number; minute: number }
  | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return { hour, minute };
}

function coerceDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLegacyMidnightCutoff(date: Date): boolean {
  return (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  );
}

function endOfLocalDayIso(reference: Date): string {
  return dealScheduleIsoForLocalDateTime(
    localDateInputValue(reference),
    DEFAULT_DEAL_EXPIRATION_TIME,
  ) as string;
}

function addLocalDays(reference: Date, days: number): Date {
  const next = new Date(reference);
  next.setDate(next.getDate() + days);
  return next;
}

export function defaultDealStartIso(reference = new Date()): string {
  return new Date(reference).toISOString();
}

export function defaultDealEndIso(reference = new Date()): string {
  const todayEndIso = endOfLocalDayIso(reference);
  if (new Date(todayEndIso).getTime() > reference.getTime()) {
    return todayEndIso;
  }
  return endOfLocalDayIso(addLocalDays(reference, 1));
}

export function isOnlyTodayPresetAvailable(reference = new Date()): boolean {
  const expiresAt = new Date(endOfLocalDayIso(reference));
  return expiresAt.getTime() > reference.getTime();
}

export function dealSchedulePresetToday(
  reference = new Date(),
): DealScheduleWindow | null {
  if (!isOnlyTodayPresetAvailable(reference)) return null;
  return {
    startsAt: defaultDealStartIso(reference),
    expiresAt: endOfLocalDayIso(reference),
  };
}

export function dealSchedulePresetTomorrow(
  reference = new Date(),
): DealScheduleWindow {
  const tomorrow = addLocalDays(reference, 1);
  return {
    startsAt: dealScheduleIsoForLocalDateTime(
      localDateInputValue(tomorrow),
      DEFAULT_DEAL_START_TIME,
    ) as string,
    expiresAt: endOfLocalDayIso(tomorrow),
  };
}

export function dealScheduleIsoForLocalDateTime(
  dateValue: string,
  timeValue = DEFAULT_DEAL_EXPIRATION_TIME,
): string | null {
  const dateParts = parseDateInputValue(dateValue);
  if (!dateParts) return null;
  const timeParts =
    parseTimeInputValue(timeValue) ??
    parseTimeInputValue(DEFAULT_DEAL_EXPIRATION_TIME);
  if (!timeParts) return null;

  const date = new Date(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    0,
    0,
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toDealScheduleDateInputValue(
  iso: string | null,
  options: DateInputOptions = {},
): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  if (
    options.legacyEndMidnightAsPreviousDay &&
    isLegacyMidnightCutoff(date)
  ) {
    const previousDay = new Date(date);
    previousDay.setDate(previousDay.getDate() - 1);
    return localDateInputValue(previousDay);
  }

  return localDateInputValue(date);
}

export function toDealScheduleTimeInputValue(
  iso: string | null,
  options: DateInputOptions = {},
): string {
  if (!iso) return DEFAULT_DEAL_EXPIRATION_TIME;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return DEFAULT_DEAL_EXPIRATION_TIME;
  if (
    options.legacyEndMidnightAsPreviousDay &&
    isLegacyMidnightCutoff(date)
  ) {
    return DEFAULT_DEAL_EXPIRATION_TIME;
  }
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function validateDealSchedule(
  input: {
    startsAt?: Date | string | null;
    expiresAt?: Date | string | null;
  },
  reference = new Date(),
): DealScheduleValidation {
  const expiresAt = coerceDate(input.expiresAt);
  if (!expiresAt) {
    return {
      ok: false,
      status: "missing",
      message: "Deal end time is required.",
    };
  }

  const startsAt = coerceDate(input.startsAt);
  if (input.startsAt && !startsAt) {
    return {
      ok: false,
      status: "invalid",
      message: "Deal start time is invalid.",
    };
  }

  if (startsAt && startsAt >= expiresAt) {
    return {
      ok: false,
      status: "invalid",
      message: DEAL_SCHEDULE_INVALID_RANGE_MESSAGE,
    };
  }

  if (startsAt && startsAt > reference) {
    return { ok: true, status: "scheduled", startsAt, expiresAt };
  }
  if (expiresAt <= reference) {
    return { ok: true, status: "expired", startsAt, expiresAt };
  }
  return { ok: true, status: "active", startsAt, expiresAt };
}
