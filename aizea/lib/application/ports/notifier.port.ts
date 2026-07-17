// Notifier port.
//
// The in-app toast system lives in `lib/utils/notify.ts` (an
// in-process pub-sub). The use case depends on this port instead of
// the concrete `notifyUser` function so it can be unit-tested with
// a spy.

export type NotificationKind = "info" | "success" | "warning" | "error";

export interface INotifier {
  /** Emit a notification to a user. The `userId` is a stable string
   *  — currently a placeholder until auth lands. */
  notify(
    userId: string,
    message: string,
    kind?: NotificationKind
  ): void;
}
