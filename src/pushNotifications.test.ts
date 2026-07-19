import { afterEach, describe, expect, it, vi } from "vitest";
import { enablePushNotifications, getPushNotificationState, hasPushNotificationSubscription } from "./pushNotifications";

const invoke = vi.fn();

vi.mock("./supabaseClient", () => ({
  getSupabaseClient: () => ({ functions: { invoke } }),
}));

const originalServiceWorker = Object.getOwnPropertyDescriptor(navigator, "serviceWorker");
const originalPushManager = Object.getOwnPropertyDescriptor(window, "PushManager");
const originalNotification = Object.getOwnPropertyDescriptor(window, "Notification");

afterEach(() => {
  invoke.mockReset();
  restoreProperty(navigator, "serviceWorker", originalServiceWorker);
  restoreProperty(window, "PushManager", originalPushManager);
  restoreProperty(window, "Notification", originalNotification);
});

describe("push notifications", () => {
  it("reports unsupported browsers without prompting", () => {
    restoreProperty(navigator, "serviceWorker", undefined);
    restoreProperty(window, "PushManager", undefined);
    restoreProperty(window, "Notification", undefined);
    expect(getPushNotificationState()).toBe("unsupported");
  });

  it("reuses an existing subscription and registers it once", async () => {
    const subscription = {
      toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { p256dh: "key", auth: "auth" } }),
    };
    const subscribe = vi.fn();
    const register = vi.fn().mockResolvedValue({
      pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe },
    });

    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register } });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class PushManager {} });
    Object.defineProperty(window, "Notification", {
      configurable: true,
      value: { permission: "granted", requestPermission: vi.fn() },
    });
    vi.stubEnv("VITE_VAPID_PUBLIC_KEY", "AQ");
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await expect(enablePushNotifications()).resolves.toBe("granted");
    expect(register).toHaveBeenCalledWith("/service-worker.js?v=3", { scope: "/" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("register-push-subscription", { body: subscription.toJSON() });
  });

  it("recognizes an existing browser push subscription after reload", async () => {
    const subscription = { endpoint: "https://push.example/subscription", toJSON: () => ({ endpoint: "https://push.example/subscription", keys: { p256dh: "key", auth: "auth" } }) };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { register: vi.fn().mockResolvedValue({ pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }) },
    });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class PushManager {} });
    Object.defineProperty(window, "Notification", { configurable: true, value: { permission: "granted" } });
    invoke.mockResolvedValue({ data: { ok: true }, error: null });

    await expect(hasPushNotificationSubscription()).resolves.toBe(true);
  });
});

function restoreProperty(target: object, property: PropertyKey, descriptor?: PropertyDescriptor) {
  if (descriptor) Object.defineProperty(target, property, descriptor);
  else Reflect.deleteProperty(target, property);
}
