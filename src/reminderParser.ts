export type DateResolution = "default_today" | "explicit_today" | "relative_day" | "weekday" | "explicit_date";

export interface ParsedReminder {
  reminderText: string;
  originalTranscript: string;
  dueDate: string;
  dueTime: string;
  dueAt: string;
  datePhrase: string | null;
  timePhrase: string;
  dateResolution: DateResolution;
}

export type ReminderParseError =
  | "empty_transcript"
  | "empty_reminder_text"
  | "missing_time"
  | "missing_date"
  | "past_due"
  | "invalid_date"
  | "invalid_time";

export type ReminderParseResult =
  | {
      ok: true;
      reminder: ParsedReminder;
    }
  | {
      ok: false;
      error: ReminderParseError;
      originalTranscript: string;
    };

interface TimeMatch {
  phrase: string;
  hour: number;
  minute: number;
}

interface DateMatch {
  phrase: string | null;
  date: Date;
  resolution: DateResolution;
}

const reminderPrefixes = [
  /^can you\s+remind me to\s+/i,
  /^please\s+remind me to\s+/i,
  /^set a\s+reminder to\s+/i,
  /^set\s+reminder to\s+/i,
  /^create a\s+reminder to\s+/i,
  /^remind me to\s+/i,
  /^reminder to\s+/i,
];

const weekdays = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

const monthIndexes: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

export function parseReminderTranscript(transcript: string, now = new Date()): ReminderParseResult {
  const originalTranscript = transcript.trim();

  if (!originalTranscript) {
    return { ok: false, error: "empty_transcript", originalTranscript };
  }

  const timeMatch = extractTime(originalTranscript);

  if (!timeMatch) {
    return { ok: false, error: "missing_time", originalTranscript };
  }

  if (!isValidTime(timeMatch.hour, timeMatch.minute)) {
    return { ok: false, error: "invalid_time", originalTranscript };
  }

  const dateMatch = extractDate(originalTranscript, now, timeMatch);

  if (dateMatch === "past_due") {
    return { ok: false, error: "past_due", originalTranscript };
  }

  if (dateMatch === "invalid_date") {
    return { ok: false, error: "invalid_date", originalTranscript };
  }

  if (!dateMatch) {
    return { ok: false, error: "missing_date", originalTranscript };
  }

  const dueAt = new Date(
    dateMatch.date.getFullYear(),
    dateMatch.date.getMonth(),
    dateMatch.date.getDate(),
    timeMatch.hour,
    timeMatch.minute,
    0,
    0,
  );

  if (dueAt.getTime() < now.getTime()) {
    return { ok: false, error: "past_due", originalTranscript };
  }

  const reminderText = cleanReminderText(originalTranscript, [timeMatch.phrase, dateMatch.phrase].filter(isPresent));

  if (!reminderText) {
    return { ok: false, error: "empty_reminder_text", originalTranscript };
  }

  return {
    ok: true,
    reminder: {
      reminderText,
      originalTranscript,
      dueDate: formatLocalDate(dueAt),
      dueTime: formatLocalTime(dueAt),
      dueAt: dueAt.toISOString(),
      datePhrase: dateMatch.phrase,
      timePhrase: timeMatch.phrase,
      dateResolution: dateMatch.resolution,
    },
  };
}

function extractTime(transcript: string): TimeMatch | null {
  const withPreposition = transcript.match(/\b(?:at|by|around)\s+(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  const standalone = transcript.match(/\b(\d{1,2}):(\d{2})\s*(a\.?m\.?|p\.?m\.?)?\b/i);
  const match = withPreposition ?? standalone;

  if (!match) {
    return null;
  }

  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  const meridian = match[3]?.toLowerCase().replace(/\./g, "");

  return {
    phrase: match[0],
    hour: normalizeHour(hour, meridian),
    minute,
  };
}

function extractDate(transcript: string, now: Date, time: TimeMatch): DateMatch | "past_due" | "invalid_date" | null {
  const relative = transcript.match(/\b(today|tomorrow|yesterday)\b/i);

  if (relative) {
    const phrase = relative[0];
    const relativeDay = phrase.toLowerCase();

    if (relativeDay === "yesterday") {
      return "past_due";
    }

    const date = startOfLocalDay(now);

    if (relativeDay === "tomorrow") {
      date.setDate(date.getDate() + 1);
      return { phrase, date, resolution: "relative_day" };
    }

    return { phrase, date, resolution: "explicit_today" };
  }

  const explicitDate = extractExplicitDate(transcript, now);

  if (explicitDate) {
    const candidate = combineDateAndTime(explicitDate.date, time);

    if (Number.isNaN(candidate.getTime())) {
      return "invalid_date";
    }

    if (candidate.getTime() < now.getTime()) {
      return "past_due";
    }

    return {
      phrase: explicitDate.phrase,
      date: explicitDate.date,
      resolution: "explicit_date",
    };
  }

  const weekday = extractWeekday(transcript, now, time);

  if (weekday) {
    return weekday;
  }

  const today = startOfLocalDay(now);
  const todayDueAt = combineDateAndTime(today, time);

  if (todayDueAt.getTime() < now.getTime()) {
    return "past_due";
  }

  return {
    phrase: null,
    date: today,
    resolution: "default_today",
  };
}

function extractExplicitDate(transcript: string, now: Date): { phrase: string; date: Date } | null {
  const numeric = transcript.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);

  if (numeric) {
    const year = normalizeYear(numeric[3], now.getFullYear());
    const date = new Date(year, Number(numeric[1]) - 1, Number(numeric[2]));

    return isExactLocalDate(date, year, Number(numeric[1]) - 1, Number(numeric[2])) ? { phrase: numeric[0], date } : null;
  }

  const monthFirst = transcript.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i,
  );

  if (monthFirst) {
    const month = monthIndexes[monthFirst[1].toLowerCase()];
    const day = Number(monthFirst[2]);
    const year = normalizeYear(monthFirst[3], now.getFullYear());
    const date = new Date(year, month, day);

    return isExactLocalDate(date, year, month, day) ? { phrase: monthFirst[0], date } : null;
  }

  const dayFirst = transcript.match(
    /\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:,?\s+(\d{4}))?\b/i,
  );

  if (dayFirst) {
    const day = Number(dayFirst[1]);
    const month = monthIndexes[dayFirst[2].toLowerCase()];
    const year = normalizeYear(dayFirst[3], now.getFullYear());
    const date = new Date(year, month, day);

    return isExactLocalDate(date, year, month, day) ? { phrase: dayFirst[0], date } : null;
  }

  return null;
}

function extractWeekday(transcript: string, now: Date, time: TimeMatch): DateMatch | null {
  const match = transcript.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i);

  if (!match) {
    return null;
  }

  const weekdayIndex = weekdays.indexOf(match[1].toLowerCase() as (typeof weekdays)[number]);
  const date = startOfLocalDay(now);
  let dayOffset = (weekdayIndex - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + dayOffset);

  const candidate = combineDateAndTime(date, time);

  if (dayOffset === 0 && candidate.getTime() < now.getTime()) {
    dayOffset = 7;
    date.setDate(startOfLocalDay(now).getDate() + dayOffset);
  }

  return {
    phrase: match[0],
    date,
    resolution: "weekday",
  };
}

function cleanReminderText(transcript: string, phrasesToRemove: string[]) {
  let text = transcript.trim();

  for (const prefix of reminderPrefixes) {
    text = text.replace(prefix, "");
  }

  for (const phrase of phrasesToRemove) {
    text = removePhrase(text, phrase);
  }

  return text
    .replace(/\b(on|for|at|by|around|to)\s*$/i, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, "")
    .trim();
}

function removePhrase(text: string, phrase: string) {
  return text.replace(new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "i"), " ");
}

function normalizeHour(hour: number, meridian?: string) {
  if (meridian === "pm" && hour < 12) {
    return hour + 12;
  }

  if (meridian === "am" && hour === 12) {
    return 0;
  }

  return hour;
}

function normalizeYear(year: string | undefined, fallbackYear: number) {
  if (!year) {
    return fallbackYear;
  }

  const parsedYear = Number(year);

  return year.length === 2 ? 2000 + parsedYear : parsedYear;
}

function isValidTime(hour: number, minute: number) {
  return Number.isInteger(hour) && Number.isInteger(minute) && hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

function combineDateAndTime(date: Date, time: TimeMatch) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), time.hour, time.minute, 0, 0);
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function isExactLocalDate(date: Date, year: number, month: number, day: number) {
  return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatLocalTime(date: Date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isPresent(value: string | null): value is string {
  return Boolean(value);
}
