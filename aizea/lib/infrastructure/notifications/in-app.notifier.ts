// InAppNotifier — `INotifier` implementation that delegates to the
// in-process pub-sub from `@/lib/utils/notify`.
//
// This is the only place the application layer touches the
// in-process notification state. The use case depends on `INotifier`,
// so swapping for a future Notification-table implementation is a
// one-file change.

import { notifyUser } from "@/lib/utils/notify";
import type {
  INotifier,
  NotificationKind,
} from "@/lib/application/ports/notifier.port";

export class InAppNotifier implements INotifier {
  notify(userId: string, message: string, kind: NotificationKind = "info"): void {
    notifyUser(userId, message, kind);
  }
}
