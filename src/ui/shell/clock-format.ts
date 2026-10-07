export interface RailDateParts {
  weekday: boolean;
  month: boolean;
  day: boolean;
  year: boolean;
}

export interface RailTimeParts {
  seconds: boolean;
  twentyFourHour: boolean;
}

export function formatRailDate(
  date: Date,
  parts: RailDateParts,
  locale?: string | string[],
): string {
  if (!parts.weekday && !parts.month && !parts.day && !parts.year) return "";
  return new Intl.DateTimeFormat(locale, {
    weekday: parts.weekday ? "short" : undefined,
    month: parts.month ? "short" : undefined,
    day: parts.day ? "numeric" : undefined,
    year: parts.year ? "numeric" : undefined,
  }).format(date);
}

export function formatRailTime(
  date: Date,
  parts: RailTimeParts,
  locale?: string | string[],
): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    second: parts.seconds ? "2-digit" : undefined,
    hour12: !parts.twentyFourHour,
  }).format(date);
}

export function formatRailAccessibleName(
  date: Date,
  timeParts: RailTimeParts,
  dateParts: RailDateParts | null,
  locale?: string | string[],
): string {
  const formattedTime = formatRailTime(date, timeParts, locale);
  const formattedDate = dateParts
    ? formatRailDate(date, dateParts, locale)
    : "";
  return formattedDate ? `${formattedTime}, ${formattedDate}` : formattedTime;
}
