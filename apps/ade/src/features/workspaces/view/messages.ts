import type { MessageDescriptor } from "react-intl";

import type { NotificationKind, VisibleStatus } from "../model/decisions";

/** The body of each desktop notification; its title is the workspace's. */
export const notificationMessages: Readonly<Record<NotificationKind, MessageDescriptor>> = {
  needsYou: { id: "notifications.needsYou" },
  finished: { id: "notifications.finished" },
};

/** The text equivalent of each status dot. */
export const statusMessages: Readonly<Record<VisibleStatus, MessageDescriptor>> = {
  working: { id: "workspaces.status.working" },
  needsYou: { id: "workspaces.status.needsYou" },
};
