import { getSupabaseClient } from "./supabaseClient";
import { parseReminderTranscript, type ParsedReminder, type ReminderCategory, type ReminderParseError } from "./reminderParser";

const audioBucketName = "audio-reminders";

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
    .select(
      "id, audio_id, reminder_text, category, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, created_at, updated_at",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (result.error) {
    throw result.error;
  }

  return result.data.map(mapReminderRow);
}

export async function completeReminder(id: string): Promise<void> {
  const supabase = getSupabaseClient();
  const result = await supabase
    .from("reminders")
    .update({
      status: "completed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (result.error) {
    throw result.error;
  }
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
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(
      "id, audio_id, reminder_text, category, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, created_at, updated_at",
    )
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
    })
    .select(
      "id, audio_id, reminder_text, category, original_transcript, due_date, due_time, due_at, date_phrase, time_phrase, date_resolution, status, created_at, updated_at",
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
  category?: string | null;
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
    category: row.category ?? "Personal",
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
