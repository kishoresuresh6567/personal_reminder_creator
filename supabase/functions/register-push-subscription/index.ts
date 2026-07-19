import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const accessToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Authentication required" }, 401);
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const email = authData.user?.email?.toLowerCase() ?? "";
    if (authError || !authData.user || !email.endsWith("@gmail.com")) return json({ error: "A Gmail account is required" }, 403);

    const input = await request.json();
    const endpoint = typeof input?.endpoint === "string" ? input.endpoint.trim() : "";
    const p256dh = typeof input?.keys?.p256dh === "string" ? input.keys.p256dh : "";
    const auth = typeof input?.keys?.auth === "string" ? input.keys.auth : "";

    if (!endpoint.startsWith("https://") || !p256dh || !auth) return json({ error: "Invalid push subscription" }, 400);

    const { error } = await supabase.from("push_subscriptions").upsert(
      { user_id: authData.user.id, endpoint, p256dh, auth, updated_at: new Date().toISOString() },
      { onConflict: "endpoint" },
    );

    if (error) throw error;
    return json({ ok: true });
  } catch (error) {
    console.error("Could not register push subscription", error);
    return json({ error: "Could not register push subscription" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
