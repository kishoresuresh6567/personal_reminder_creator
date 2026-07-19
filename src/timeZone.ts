export const APP_TIME_ZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;

export function getIstWallClock(instant = new Date()) {
  const parts = getIstParts(instant);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
}

export function istWallClockToInstant(wallClock: Date) {
  const utcMilliseconds = Date.UTC(
    wallClock.getFullYear(), wallClock.getMonth(), wallClock.getDate(),
    wallClock.getHours(), wallClock.getMinutes(), wallClock.getSeconds(), wallClock.getMilliseconds(),
  ) - IST_OFFSET_MINUTES * 60_000;
  return new Date(utcMilliseconds);
}

export function istDateTimeToISOString(date: string, time: string) {
  const match = `${date} ${time}`.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error("Invalid IST date or time");
  const wallClock = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  return istWallClockToInstant(wallClock).toISOString();
}

export function formatIstDate(instant: Date) {
  const { year, month, day } = getIstParts(instant);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function formatIstTime(instant: Date) {
  const { hour, minute, second } = getIstParts(instant);
  return `${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

function getIstParts(instant: Date) {
  const values: Record<string, number> = {};
  new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function pad(value: number) { return String(value).padStart(2, "0"); }
