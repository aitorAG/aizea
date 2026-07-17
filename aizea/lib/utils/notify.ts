import { randomUUID } from "node:crypto";

// notify — tiny in-process pub-sub for in-app notifications.
//
// Why a pub-sub instead of a DB table? The Prisma schema has no
// Notification model yet (the wave-6 plan flags it as optional). For
// now we keep notifications in memory; subscribers (the React toast
// layer, server actions, tests) can attach listeners and react to
// events in real time. When a Notification table is added in a later
// wave, only the storage step in `notifyUser` needs to change — the
// API stays the same.

export type NotificationType = "info" | "success" | "warning" | "error";

export interface Notification {
  id: string;
  userId: string;
  message: string;
  type: NotificationType;
  createdAt: string;
  read: boolean;
}

const notifications: Notification[] = [];
const subscribers: Set<(n: Notification) => void> = new Set();

/**
 * Emit a notification. Returns the created Notification so callers can
 * inspect the assigned id and timestamp.
 */
export function notifyUser(
  userId: string,
  message: string,
  type: NotificationType = "info"
): Notification {
  const n: Notification = {
    id: randomUUID(),
    userId,
    message,
    type,
    createdAt: new Date().toISOString(),
    read: false,
  };
  notifications.push(n);
  if (process.env.NODE_ENV !== "test") {
    console.log(`[notify] ${type.toUpperCase()} (${userId}): ${message}`);
  }
  for (const sub of subscribers) {
    try {
      sub(n);
    } catch (err) {
      // A misbehaving listener must not break the others (and must not
      // crash the calling pipeline). Log and move on.
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          "[notify] subscriber threw, continuing:",
          err instanceof Error ? err.message : err
        );
      }
    }
  }
  return n;
}

/**
 * Register a callback fired on every new notification. Returns an
 * unsubscribe function — callers should call it on teardown to avoid
 * memory leaks.
 */
export function subscribeToNotifications(
  callback: (n: Notification) => void
): () => void {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

/**
 * Return every notification created so far for the given user, in
 * insertion order.
 */
export function getNotificationsForUser(userId: string): Notification[] {
  return notifications.filter((n) => n.userId === userId);
}

/**
 * Wipe notifications and detach every listener. Test-only helper — the
 * production code never calls it.
 */
export function clearNotifications(): void {
  notifications.length = 0;
  subscribers.clear();
}

/**
 * Total notification count, for diagnostics / tests.
 */
export function notificationCount(): number {
  return notifications.length;
}
