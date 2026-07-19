import { getSupabaseClient } from "./supabaseClient";

export type PushNotificationState = "unsupported" | NotificationPermission;

export function getPushNotificationState(): PushNotificationState {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function registerPushServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.register("/service-worker.js?v=3", { scope: "/" });
}

export async function hasPushNotificationSubscription() {
  if (getPushNotificationState() !== "granted") return false;
  const registration = await registerPushServiceWorker();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return false;
  await registerSubscription(subscription);
  return true;
}

export async function enablePushNotifications(): Promise<PushNotificationState> {
  const currentState = getPushNotificationState();
  if (currentState === "unsupported" || currentState === "denied") return currentState;

  const permission = currentState === "granted" ? currentState : await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) throw new Error("Background notifications are not configured.");

  const registration = await registerPushServiceWorker();
  if (!registration) return "unsupported";

  let subscription = await registration.pushManager.getSubscription();
  subscription ??= await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidPublicKey(vapidPublicKey),
  });

  await registerSubscription(subscription);
  return "granted";
}

async function registerSubscription(subscription: PushSubscription) {
  const result = await getSupabaseClient().functions.invoke("register-push-subscription", { body: subscription.toJSON() });
  if (result.error) throw result.error;
}

function decodeVapidPublicKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
