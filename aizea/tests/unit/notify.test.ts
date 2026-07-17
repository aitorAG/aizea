import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:crypto", () => ({
  randomUUID: vi.fn(() => "uuid-1"),
}));

import {
  notifyUser,
  subscribeToNotifications,
  getNotificationsForUser,
  clearNotifications,
  type Notification,
  type NotificationType,
} from "@/lib/utils/notify";

describe("notify", () => {
  beforeEach(() => {
    clearNotifications();
  });

  describe("notifyUser", () => {
    it("creates a notification with the given message and type", () => {
      const n = notifyUser("u1", "Hello", "info");
      expect(n.userId).toBe("u1");
      expect(n.message).toBe("Hello");
      expect(n.type).toBe("info");
      expect(n.read).toBe(false);
      expect(n.createdAt).toBeTruthy();
    });

    it("defaults to 'info' when no type is given", () => {
      const n = notifyUser("u1", "Hello");
      expect(n.type).toBe("info");
    });

    it("accepts every supported NotificationType", () => {
      const types: NotificationType[] = ["info", "success", "warning", "error"];
      for (const t of types) {
        clearNotifications();
        const n = notifyUser("u", "m", t);
        expect(n.type).toBe(t);
      }
    });

    it("returns a unique id for every notification", async () => {
      // Force distinct uuids.
      const ids = new Set<string>();
      const { randomUUID } = await import("node:crypto");
      const mockUuid = vi.mocked(randomUUID);
      for (let i = 0; i < 3; i++) {
        mockUuid.mockReturnValueOnce(
          `00000000-0000-0000-0000-${String(i).padStart(12, "0")}` as ReturnType<typeof randomUUID>
        );
        const n = notifyUser("u", `m${i}`);
        ids.add(n.id);
      }
      expect(ids.size).toBe(3);
    });

    it("appends to the per-user feed", () => {
      notifyUser("u1", "A");
      notifyUser("u1", "B");
      notifyUser("u2", "C");
      expect(getNotificationsForUser("u1")).toHaveLength(2);
      expect(getNotificationsForUser("u2")).toHaveLength(1);
    });
  });

  describe("subscribeToNotifications", () => {
    it("delivers each new notification to the subscriber", () => {
      const sub = vi.fn();
      subscribeToNotifications(sub);

      notifyUser("u1", "Hello", "info");

      expect(sub).toHaveBeenCalledTimes(1);
      const arg = sub.mock.calls[0][0] as Notification;
      expect(arg.userId).toBe("u1");
      expect(arg.message).toBe("Hello");
    });

    it("returns an unsubscribe function that detaches the listener", () => {
      const sub = vi.fn();
      const unsubscribe = subscribeToNotifications(sub);

      notifyUser("u1", "Before");
      unsubscribe();
      notifyUser("u1", "After");

      expect(sub).toHaveBeenCalledTimes(1);
    });

    it("continues calling other subscribers if one throws", () => {
      const bad = vi.fn(() => {
        throw new Error("listener boom");
      });
      const good = vi.fn();
      subscribeToNotifications(bad);
      subscribeToNotifications(good);

      notifyUser("u1", "Hello");

      expect(bad).toHaveBeenCalledTimes(1);
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe("getNotificationsForUser", () => {
    it("returns an empty array for an unknown user", () => {
      expect(getNotificationsForUser("nobody")).toEqual([]);
    });

    it("preserves insertion order", () => {
      notifyUser("u", "first");
      notifyUser("u", "second");
      notifyUser("u", "third");
      const list = getNotificationsForUser("u");
      expect(list.map((n) => n.message)).toEqual([
        "first",
        "second",
        "third",
      ]);
    });
  });

  describe("clearNotifications", () => {
    it("wipes every notification and unsubscribes every listener", () => {
      const sub = vi.fn();
      subscribeToNotifications(sub);
      notifyUser("u", "msg");
      expect(sub).toHaveBeenCalledTimes(1);

      clearNotifications();

      expect(getNotificationsForUser("u")).toEqual([]);
      notifyUser("u", "after-clear");
      // After clear, the subscriber should not be invoked any more —
      // call count stays at 1 (the call from before the clear).
      expect(sub).toHaveBeenCalledTimes(1);
    });
  });
});
