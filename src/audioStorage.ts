import { getSupabaseClient } from "./supabaseClient";

const audioBucketName = "audio-reminders";

export interface AudioReminderInput {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  transcriptText: string | null;
  transcriptStatus: string;
  transcriptError: string | null;
  transcribedAt: string | null;
}

export interface AudioReminderRecord {
  id: string;
  storagePath: string;
  mimeType: string;
  durationMs: number;
  sizeBytes: number;
  createdAt: string;
  transcriptText: string | null;
  transcriptStatus: string;
  transcriptError: string | null;
  transcribedAt: string | null;
}

export async function saveAudioReminder(input: AudioReminderInput): Promise<AudioReminderRecord> {
  const supabase = getSupabaseClient();
  const storagePath = createStoragePath(input.mimeType);

  const uploadResult = await supabase.storage.from(audioBucketName).upload(storagePath, input.blob, {
    contentType: input.mimeType,
    upsert: false,
  });

  if (uploadResult.error) {
    throw uploadResult.error;
  }

  const insertResult = await supabase
    .from("audio")
    .insert({
      storage_path: storagePath,
      mime_type: input.mimeType,
      duration_ms: input.durationMs,
      size_bytes: input.blob.size,
      transcript_text: input.transcriptText,
      transcript_status: input.transcriptStatus,
      transcript_error: input.transcriptError,
      transcribed_at: input.transcribedAt,
    })
    .select(
      "id, storage_path, mime_type, duration_ms, size_bytes, created_at, transcript_text, transcript_status, transcript_error, transcribed_at",
    )
    .single();

  if (insertResult.error) {
    await supabase.storage.from(audioBucketName).remove([storagePath]);
    throw insertResult.error;
  }

  return {
    id: insertResult.data.id,
    storagePath: insertResult.data.storage_path,
    mimeType: insertResult.data.mime_type,
    durationMs: insertResult.data.duration_ms,
    sizeBytes: insertResult.data.size_bytes,
    createdAt: insertResult.data.created_at,
    transcriptText: insertResult.data.transcript_text,
    transcriptStatus: insertResult.data.transcript_status,
    transcriptError: insertResult.data.transcript_error,
    transcribedAt: insertResult.data.transcribed_at,
  };
}

function createStoragePath(mimeType: string) {
  const extension = getAudioExtension(mimeType);
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `audio/${Date.now()}-${id}.${extension}`;
}

function getAudioExtension(mimeType: string) {
  if (mimeType.includes("mp4")) {
    return "m4a";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  return "webm";
}
