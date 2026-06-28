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

  return {
    id: insertResult.data.id,
    audioId: insertResult.data.audio_id,
    reminderText: insertResult.data.reminder_text,
    originalTranscript: insertResult.data.original_transcript,
    dueDate: insertResult.data.due_date,
    dueTime: insertResult.data.due_time,
    dueAt: insertResult.data.due_at,
    datePhrase: insertResult.data.date_phrase,
    timePhrase: insertResult.data.time_phrase,
    dateResolution: insertResult.data.date_resolution,
    status: insertResult.data.status,
    createdAt: insertResult.data.created_at,
    updatedAt: insertResult.data.updated_at,
  };
}
