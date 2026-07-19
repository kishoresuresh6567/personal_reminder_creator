import { createClient } from "@supabase/supabase-js";

export interface Database {
  public: {
    Tables: {
      audio: {
        Row: {
          id: string;
          user_id: string;
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
          user_id?: string;
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
          user_id?: string;
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
          user_id: string;
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
          push_eligible: boolean;
          push_notified_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id?: string;
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
          push_eligible?: boolean;
          push_notified_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
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
          push_eligible?: boolean;
          push_notified_at?: string | null;
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
      push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string; updated_at: string; last_success_at: string | null };
        Insert: { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string; updated_at?: string; last_success_at?: string | null };
        Update: { id?: string; user_id?: string; endpoint?: string; p256dh?: string; auth?: string; created_at?: string; updated_at?: string; last_success_at?: string | null };
        Relationships: [];
      };
      push_deliveries: {
        Row: { reminder_id: string; subscription_id: string; status: string; attempts: number; next_attempt_at: string; claimed_at: string | null; sent_at: string | null; last_error: string | null };
        Insert: { reminder_id: string; subscription_id: string; status?: string; attempts?: number; next_attempt_at?: string; claimed_at?: string | null; sent_at?: string | null; last_error?: string | null };
        Update: { reminder_id?: string; subscription_id?: string; status?: string; attempts?: number; next_attempt_at?: string; claimed_at?: string | null; sent_at?: string | null; last_error?: string | null };
        Relationships: [
          { foreignKeyName: "push_deliveries_reminder_id_fkey"; columns: ["reminder_id"]; referencedRelation: "reminders"; referencedColumns: ["id"] },
          { foreignKeyName: "push_deliveries_subscription_id_fkey"; columns: ["subscription_id"]; referencedRelation: "push_subscriptions"; referencedColumns: ["id"] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_due_push_deliveries: {
        Args: { batch_size?: number };
        Returns: Array<{ reminder_id: string; subscription_id: string; endpoint: string; p256dh: string; auth: string; reminder_text: string; due_at: string }>;
      };
    };
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
