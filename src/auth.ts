import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { getSupabaseClient } from "./supabaseClient";

export function useAuthSession() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const applySession = async (session: Session | null) => {
      const nextUser = session?.user ?? null;
      if (nextUser && !nextUser.email?.toLowerCase().endsWith("@gmail.com")) {
        await supabase.auth.signOut();
        setUser(null);
        setAuthError("Please sign in with a personal @gmail.com account.");
      } else {
        setUser(nextUser);
      }
      setIsLoading(false);
    };

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => void applySession(session));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signInWithGoogle() {
    setAuthError(null);
    const { error } = await getSupabaseClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }

  async function signOut() {
    const { error } = await getSupabaseClient().auth.signOut();
    if (error) throw error;
  }

  return { user, isLoading, authError, signInWithGoogle, signOut };
}
