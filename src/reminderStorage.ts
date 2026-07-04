import { getSupabaseClient } from "./supabaseClient";
import { parseReminderTranscript, type ParsedReminder, type ReminderParseError } from "./reminderParser";

export interface ReminderRecord {
  id: string;
  audioId: string | null;
  reminderText: string;
  originalTranscript: string | null;
  dueDate: string;
  dueTime: string;
  dueAt: string;
  datePhrase: string | null;
  timePhrase: string | null;
  dateResolution: string;
  status: string;
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
    .select(
      "id, audio_id, reminder_text, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return result.data.map(mapReminderRow);
}

async function insertReminder(audioId: string | null, reminder: ParsedReminder): Promise<ReminderRecord> {
  const supabase = getSupabaseClient();
  const insertResult = await supabase
    .from("reminders")
    .insert({
      audio_id: audioId,
      reminder_text: reminder.reminderText,
      original_transcript: reminder.originalTranscript,
      due_date: reminder.dueDate,
      due_time: reminder.dueTime,
      due_at: reminder.dueAt,
      date_phrase: reminder.datePhrase,
      time_phrase: reminder.timePhrase,
      date_resolution: reminder.dateResolution,
    })
    .select(
      "id, audio_id, reminder_text, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, created_at, updated_at",
    )
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
  original_transcript: string | null;
  due_date: string;
  due_time: string;
  due_at: string;
  date_phrase: string | null;
  time_phrase: string | null;
  date_resolution: string;
  status: string;
  created_at: string;
  updated_at: string;
}): ReminderRecord {
  return {
    id: row.id,
    audioId: row.audio_id,
    reminderText: row.reminder_text,
    originalTranscript: row.original_transcript,
    dueDate: row.due_date,
    dueTime: row.due_time,
    dueAt: row.due_at,
    datePhrase: row.date_phrase,
    timePhrase: row.time_phrase,
    dateResolution: row.date_resolution,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
