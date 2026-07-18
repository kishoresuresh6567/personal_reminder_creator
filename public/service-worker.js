self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data?.json() ?? {}; } catch { payload = { body: event.data?.text() }; }

  event.waitUntil(self.registration.showNotification(payload.title || "Reminder alarm", {
    body: payload.body || "A reminder is due now.",
    icon: "/alarm-icon.svg",
    badge: "/alarm-badge.svg",
    tag: payload.tag || (payload.reminderId ? `reminder-${payload.reminderId}` : "reminder-alarm"),
    renotify: true,
    requireInteraction: true,
    timestamp: payload.dueAt ? Date.parse(payload.dueAt) : Date.now(),
    actions: [
      { action: "snooze-5", title: "Snooze 5m" },
      { action: "stop", title: "Stop" },
    ],
    data: { reminderId: payload.reminderId || null, url: payload.reminderId ? `/?alarm=${encodeURIComponent(payload.reminderId)}` : "/" },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const reminderId = event.notification.data?.reminderId;
  const target = new URL(event.notification.data?.url || "/", self.location.origin);
  if (reminderId && event.action) target.searchParams.set("action", event.action);
  const targetUrl = target.href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
    const client = clients.find((candidate) => new URL(candidate.url).origin === self.location.origin);
    if (client) { await client.navigate(targetUrl); return client.focus(); }
    return self.clients.openWindow(targetUrl);
  }));
});
