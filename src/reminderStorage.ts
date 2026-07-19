import { getSupabaseClient } from "./supabaseClient";
import { parseReminderTranscript, type ParsedReminder, type ReminderCategory, type ReminderParseError } from "./reminderParser";
import { getIstWallClock, istWallClockToInstant } from "./timeZone";

const audioBucketName = "audio-reminders";
const reminderSelectColumns =
  "id, audio_id, reminder_text, category, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, push_eligible, push_notified_at, created_at, updated_at";

export interface ReminderRecord {
  id: string;
  audioId: string | null;
  reminderText: string;
  category?: ReminderCategory | string | null;
  originalTranscript: string | null;
  dueDate: string;
  dueTime: string;
  dueAt: string;
  datePhrase: string | null;
  timePhrase: string | null;
  dateResolution: string;
  status: string;
  pushEligible?: boolean;
  pushNotifiedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreateReminderResult =
  | {
      ok: true;
      reminder: ReminderRecord;
    }
  | {
      ok: false;
      error: ReminderParseError;
      originalTranscript: string;
    };

export interface RescheduleReminderInput {
  dueDate: string;
  dueTime: string;
  dueAt: string;
  datePhrase: string;
  timePhrase: string;
  dateResolution: string;
}

export async function createReminderFromTranscript(input: {
  audioId?: string | null;
  transcript: string;
  now?: Date;
}): Promise<CreateReminderResult> {
  const parsed = parseReminderTranscript(input.transcript, input.now);

  if (!parsed.ok) {
    return parsed;
  }

  return {
    ok: true,
    reminder: await insertReminder(input.audioId ?? null, parsed.reminder),
  };
}

export async function listRecentReminders(limit = 3): Promise<ReminderRecord[]> {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("reminders")
    .select(reminderSelectColumns)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return result.data.map(mapReminderRow);
}

export async function completeReminder(id: string): Promise<ReminderRecord | null> {
  const supabase = getSupabaseClient();

  const reminderResult = await supabase
    .from("reminders")
    .select(reminderSelectColumns)
    .eq("id", id)
    .maybeSingle();

  if (reminderResult.error) {
    throw reminderResult.error;
  }

  const reminder = reminderResult.data ? mapReminderRow(reminderResult.data) : null;
  const nextOccurrence = reminder ? getNextRecurringOccurrence(reminder) : null;
  const updatePayload = nextOccurrence
    ? {
        due_date: nextOccurrence.dueDate,
        due_at: nextOccurrence.dueAt,
        status: "pending",
        push_notified_at: null,
        updated_at: new Date().toISOString(),
      }
    : {
        status: "completed",
        updated_at: new Date().toISOString(),
      };

  const result = nextOccurrence
    ? await supabase.from("reminders").update(updatePayload).eq("id", id).select(reminderSelectColumns).single()
    : await supabase.from("reminders").update(updatePayload).eq("id", id);

  if (result.error) {
    throw result.error;
  }

  if (nextOccurrence) {
    const updatedReminder = result.data;

    if (!updatedReminder) {
      throw new Error("Recurring reminder was not returned after completion.");
    }

    return mapReminderRow(updatedReminder);
  }

  return null;
}

export async function rescheduleReminder(id: string, input: RescheduleReminderInput): Promise<ReminderRecord> {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("reminders")
    .update({
      due_date: input.dueDate,
      due_time: input.dueTime,
      due_at: input.dueAt,
      date_phrase: input.datePhrase,
      time_phrase: input.timePhrase,
      date_resolution: input.dateResolution,
      push_notified_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(reminderSelectColumns)
    .single();

  if (result.error) {
    throw result.error;
  }

  return mapReminderRow(result.data);
}

export async function deleteReminder(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const reminderResult = await supabase.from("reminders").select("audio_id").eq("id", id).maybeSingle();

  if (reminderResult.error) {
    throw reminderResult.error;
  }

  const audioId = reminderResult.data?.audio_id ?? null;
  const audioResult = audioId ? await supabase.from("audio").select("storage_path").eq("id", audioId).maybeSingle() : null;

  if (audioResult?.error) {
    throw audioResult.error;
  }

  const storagePath = audioResult?.data?.storage_path ?? null;

  if (storagePath) {
    const storageDeleteResult = await supabase.storage.from(audioBucketName).remove([storagePath]);

    if (storageDeleteResult.error) {
      throw storageDeleteResult.error;
    }

    if (storageDeleteResult.data.length === 0) {
      throw new Error("Audio file was not deleted from storage.");
    }
  }

  const reminderDeleteResult = await supabase.from("reminders").delete().eq("id", id);

  if (reminderDeleteResult.error) {
    throw reminderDeleteResult.error;
  }

  if (!audioId) {
    return;
  }

  const audioDeleteResult = await supabase.from("audio").delete().eq("id", audioId);

  if (audioDeleteResult.error) {
    throw audioDeleteResult.error;
  }
}

async function insertReminder(audioId: string | null, reminder: ParsedReminder): Promise<ReminderRecord> {
  const supabase = getSupabaseClient();
  const insertResult = await supabase
    .from("reminders")
    .insert({
      audio_id: audioId,
      reminder_text: reminder.reminderText,
      category: reminder.category,
      original_transcript: reminder.originalTranscript,
      due_date: reminder.dueDate,
      due_time: reminder.dueTime,
      due_at: reminder.dueAt,
      date_phrase: reminder.datePhrase,
      time_phrase: reminder.timePhrase,
      date_resolution: reminder.dateResolution,
      push_eligible: true,
    })
    .select(reminderSelectColumns)
    .single();

  if (insertResult.error) {
    throw insertResult.error;
  }

  return mapReminderRow(insertResult.data);
}

function mapReminderRow(row: {
  id: string;
  audio_id: string | null;
  reminder_text: string;
  category?: string | null;
  original_transcript: string | null;
  due_date: string;
  due_time: string;
  due_at: string;
  date_phrase: string | null;
  time_phrase: string | null;
  date_resolution: string;
  status: string;
  push_eligible: boolean;
  push_notified_at: string | null;
  created_at: string;
  updated_at: string;
}): ReminderRecord {
  return {
    id: row.id,
    audioId: row.audio_id,
    reminderText: row.reminder_text,
    category: row.category ?? "Personal",
    originalTranscript: row.original_transcript,
    dueDate: row.due_date,
    dueTime: row.due_time,
    dueAt: row.due_at,
    datePhrase: row.date_phrase,
    timePhrase: row.time_phrase,
    dateResolution: row.date_resolution,
    status: row.status,
    pushEligible: row.push_eligible,
    pushNotifiedAt: row.push_notified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getNextRecurringOccurrence(reminder: ReminderRecord, now = new Date()) {
  const timeParts = reminder.dueTime.match(/^(\d{2}):(\d{2})(?::\d{2})?$/);

  if (!timeParts || (reminder.dateResolution !== "rescheduled_daily" && reminder.dateResolution !== "rescheduled_weekly")) {
    return null;
  }

  const hour = Number(timeParts[1]);
  const minute = Number(timeParts[2]);
  const nowWallClock = getIstWallClock(now);
  const baseDate = parseLocalDate(reminder.dueDate) ?? nowWallClock;
  const candidate = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), hour, minute, 0, 0);

  if (reminder.dateResolution === "rescheduled_daily") {
    candidate.setDate(candidate.getDate() + 1);

    while (candidate.getTime() <= nowWallClock.getTime()) {
      candidate.setDate(candidate.getDate() + 1);
    }

    return {
      dueDate: formatLocalDate(candidate),
      dueAt: istWallClockToInstant(candidate).toISOString(),
    };
  }

  const weeklyCandidate = getNextWeeklyOccurrence(candidate, parseWeeklyScheduleDays(reminder.datePhrase), nowWallClock);

  return {
    dueDate: formatLocalDate(weeklyCandidate),
    dueAt: istWallClockToInstant(weeklyCandidate).toISOString(),
  };
}

function getNextWeeklyOccurrence(currentOccurrence: Date, weekdays: number[], now: Date) {
  const candidate = new Date(currentOccurrence);
  candidate.setDate(candidate.getDate() + 1);

  for (let dayOffset = 0; dayOffset < 370; dayOffset += 1) {
    if (candidate.getTime() > now.getTime() && weekdays.includes(candidate.getDay())) {
      return candidate;
    }

    candidate.setDate(candidate.getDate() + 1);
  }

  candidate.setDate(currentOccurrence.getDate() + 7);
  return candidate;
}

function parseWeeklyScheduleDays(datePhrase: string | null) {
  const encodedDays = datePhrase?.match(/^weekly schedule:([\d,]+)$/)?.[1];
  const weekdays =
    encodedDays
      ?.split(",")
      .map(Number)
      .filter((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) ?? [];

  return weekdays.length > 0 ? weekdays : [1];
}

function parseLocalDate(value: string) {
  const dateParts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!dateParts) {
    return null;
  }

  return new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]));
}

function formatLocalDate(date: Date) {
  return `${date.getFullYear()}-${padTwoDigits(date.getMonth() + 1)}-${padTwoDigits(date.getDate())}`;
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, "0");
}
