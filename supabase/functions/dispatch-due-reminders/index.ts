import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

type Delivery = {
  reminder_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  reminder_text: string;
  due_at: string;
};

Deno.serve(async (request) => {
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (request.headers.get("x-scheduler-secret") !== Deno.env.get("SCHEDULER_SECRET")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:admin@example.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  const { data, error } = await supabase.rpc("claim_due_push_deliveries", { batch_size: 100 });
  if (error) {
    console.error("Could not claim push deliveries", error);
    return Response.json({ error: "Could not claim deliveries" }, { status: 500 });
  }

  const affectedReminders = new Set<string>();
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const delivery of (data ?? []) as Delivery[]) {
    affectedReminders.add(delivery.reminder_id);
    const payload = JSON.stringify({
      title: "Reminder alarm",
      body: delivery.reminder_text,
      reminderId: delivery.reminder_id,
      dueAt: delivery.due_at,
      tag: `reminder-${delivery.reminder_id}`,
    });

    try {
      await webpush.sendNotification(
        { endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
        payload,
        { TTL: 3600, urgency: "high" },
      );
      sent += 1;
      await supabase.from("push_deliveries").update({ status: "sent", sent_at: new Date().toISOString(), claimed_at: null, last_error: null })
        .eq("reminder_id", delivery.reminder_id).eq("subscription_id", delivery.subscription_id);
      await supabase.from("push_subscriptions").update({ last_success_at: new Date().toISOString() }).eq("id", delivery.subscription_id);
    } catch (pushError) {
      const statusCode = getStatusCode(pushError);
      const message = getErrorMessage(pushError).slice(0, 500);

      if (statusCode === 404 || statusCode === 410) {
        failed += 1;
        await supabase.from("push_subscriptions").delete().eq("id", delivery.subscription_id);
      } else {
        const { data: current } = await supabase.from("push_deliveries").select("attempts").eq("reminder_id", delivery.reminder_id)
          .eq("subscription_id", delivery.subscription_id).single();
        const attempts = current?.attempts ?? 1;
        const isFinalAttempt = attempts >= 5;
        isFinalAttempt ? failed += 1 : retried += 1;
        await supabase.from("push_deliveries").update({
          status: isFinalAttempt ? "failed" : "retry",
          next_attempt_at: new Date(Date.now() + Math.min(15, 2 ** attempts) * 60_000).toISOString(),
          claimed_at: null,
          last_error: message,
        }).eq("reminder_id", delivery.reminder_id).eq("subscription_id", delivery.subscription_id);
      }
    }
  }

  for (const reminderId of affectedReminders) {
    const { count } = await supabase.from("push_deliveries").select("*", { count: "exact", head: true })
      .eq("reminder_id", reminderId).in("status", ["pending", "processing", "retry"]);
    if (count === 0) await supabase.from("reminders").update({ push_notified_at: new Date().toISOString() }).eq("id", reminderId);
  }

  return Response.json({ claimed: data?.length ?? 0, sent, retried, failed });
});

function getStatusCode(error: unknown) {
  return typeof error === "object" && error && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 0;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
