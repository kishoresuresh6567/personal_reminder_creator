import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const selectColumns = "id, storage_path, mime_type, duration_ms, size_bytes, created_at, transcript_text, transcript_status, transcript_error, transcribed_at";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let audioId = "";

  try {
    const accessToken = (request.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!accessToken) return json({ error: "Authentication required" }, 401);

    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    if (authError || !authData.user) return json({ error: "Invalid session" }, 401);

    const input = await request.json();
    audioId = typeof input?.audioId === "string" ? input.audioId : "";
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(audioId)) return json({ error: "Invalid audio ID" }, 400);

    const { data: audio, error: audioError } = await supabase.from("audio")
      .select("id, user_id, storage_path, mime_type, size_bytes")
      .eq("id", audioId).eq("user_id", authData.user.id).maybeSingle();
    if (audioError) throw audioError;
    if (!audio) return json({ error: "Recording not found" }, 404);
    if (audio.size_bytes > 10_000_000) return json({ error: "Recording is too large to transcribe" }, 413);

    await supabase.from("audio").update({ transcript_status: "processing", transcript_error: null }).eq("id", audioId);

    const { data: audioBlob, error: downloadError } = await supabase.storage.from("audio-reminders").download(audio.storage_path);
    if (downloadError) throw downloadError;

    const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
    const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
    if (!accountId || !apiToken) throw new Error("Cloudflare transcription is not configured");

    const cloudflareResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/openai/whisper-large-v3-turbo`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ audio: toBase64(await audioBlob.arrayBuffer()), language: "en", vad_filter: true }),
      },
    );
    const cloudflareResult = await cloudflareResponse.json();
    const transcript = typeof cloudflareResult?.result?.text === "string" ? cloudflareResult.result.text.trim() : "";
    if (!cloudflareResponse.ok || !cloudflareResult?.success) {
      throw new Error(cloudflareResult?.errors?.[0]?.message || `Cloudflare returned ${cloudflareResponse.status}`);
    }
    if (!transcript) throw new Error("No speech was detected in the recording");

    const transcribedAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase.from("audio").update({
      transcript_text: transcript,
      transcript_status: "completed",
      transcript_error: null,
      transcribed_at: transcribedAt,
    }).eq("id", audioId).eq("user_id", authData.user.id).select(selectColumns).single();
    if (updateError) throw updateError;

    return json({ audio: updated });
  } catch (error) {
    const message = getErrorMessage(error).slice(0, 500);
    console.error("Could not transcribe audio", { audioId, error: message });
    if (audioId) await supabase.from("audio").update({ transcript_status: "failed", transcript_error: message }).eq("id", audioId);
    return json({ error: message }, 502);
  }
});

function toBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
