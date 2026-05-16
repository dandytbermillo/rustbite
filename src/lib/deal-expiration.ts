import {
  DEFAULT_DEAL_EXPIRATION_TIME,
  DEFAULT_DEAL_EXPIRATION_TIME_LABEL,
  dealScheduleIsoForLocalDateTime,
  dealSchedulePresetToday,
  dealSchedulePresetTomorrow,
  defaultDealEndIso,
  defaultDealStartIso,
  toDealScheduleDateInputValue,
  toDealScheduleTimeInputValue,
} from "@/lib/deal-schedule";

export {
  DEFAULT_DEAL_EXPIRATION_TIME,
  DEFAULT_DEAL_EXPIRATION_TIME_LABEL,
  defaultDealStartIso,
};

export function dealExpirationIsoForLocalDateValue(
  dateValue: string,
  timeValue = DEFAULT_DEAL_EXPIRATION_TIME,
): string | null {
  return dealScheduleIsoForLocalDateTime(dateValue, timeValue);
}

export function defaultDealExpirationIso(reference = new Date()): string {
  return defaultDealEndIso(reference);
}

export function dealExpirationPresetIso(daysFromToday: number): string {
  const preset =
    daysFromToday === 0
      ? dealSchedulePresetToday()
      : dealSchedulePresetTomorrow();
  return preset?.expiresAt ?? defaultDealEndIso();
}

export function toDealExpirationDateInputValue(iso: string | null): string {
  return toDealScheduleDateInputValue(iso, {
    legacyEndMidnightAsPreviousDay: true,
  });
}

export function toDealExpirationTimeInputValue(iso: string | null): string {
  return toDealScheduleTimeInputValue(iso, {
    legacyEndMidnightAsPreviousDay: true,
  });
}
