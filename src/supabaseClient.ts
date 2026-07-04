import { createClient } from "@supabase/supabase-js";

export interface Database {
  public: {
    Tables: {
      audio: {
        Row: {
          id: string;
          storage_path: string;
          mime_type: string;
          duration_ms: number;
          size_bytes: number;
          created_at: string;
          transcript_text: string | null;
          transcript_status: string;
          transcript_error: string | null;
          transcribed_at: string | null;
        };
        Insert: {
          id?: string;
          storage_path: string;
          mime_type: string;
          duration_ms: number;
          size_bytes: number;
          created_at?: string;
          transcript_text?: string | null;
          transcript_status?: string;
          transcript_error?: string | null;
          transcribed_at?: string | null;
        };
        Update: {
          id?: string;
          storage_path?: string;
          mime_type?: string;
          duration_ms?: number;
          size_bytes?: number;
          created_at?: string;
          transcript_text?: string | null;
          transcript_status?: string;
          transcript_error?: string | null;
          transcribed_at?: string | null;
        };
        Relationships: [];
      };
      reminders: {
        Row: {
          id: string;
          audio_id: string | null;
          reminder_text: string;
          category: string;
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
        };
        Insert: {
          id?: string;
          audio_id?: string | null;
          reminder_text: string;
          category?: string;
          original_transcript?: string | null;
          due_date: string;
          due_time: string;
          due_at: string;
          date_phrase?: string | null;
          time_phrase?: string | null;
          date_resolution: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          audio_id?: string | null;
          reminder_text?: string;
          category?: string;
          original_transcript?: string | null;
          due_date?: string;
          due_time?: string;
          due_at?: string;
          date_phrase?: string | null;
          time_phrase?: string | null;
          date_resolution?: string;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "reminders_audio_id_fkey";
            columns: ["audio_id"];
            referencedRelation: "audio";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

let supabaseClient: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseClient() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase environment variables.");
  }

  supabaseClient ??= createClient<Database>(supabaseUrl, supabaseAnonKey);

  return supabaseClient;
}
