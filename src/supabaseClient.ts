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
        };
        Insert: {
          id?: string;
          storage_path: string;
          mime_type: string;
          duration_ms: number;
          size_bytes: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          storage_path?: string;
          mime_type?: string;
          duration_ms?: number;
          size_bytes?: number;
          created_at?: string;
        };
        Relationships: [];
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
