import type { ConversationItem } from "@lervo/session-host-contract";
import type { MessageDescriptor } from "react-intl";

import type { Activity } from "../model/activity";

/** The working line's text for each activity, with static IDs the catalog check can see. */
export const activityMessages: Readonly<Record<Activity["kind"] | "starting", MessageDescriptor>> =
  {
    starting: { id: "conversation.activity.starting" },
    thinking: { id: "conversation.activity.thinking" },
    writing: { id: "conversation.activity.writing" },
    tool: { id: "conversation.tool.running" },
  };

/** A tool line's text for each status. */
export const toolMessages: Readonly<
  Record<Extract<ConversationItem, { kind: "tool_activity" }>["tool"]["status"], MessageDescriptor>
> = {
  running: { id: "conversation.tool.running" },
  succeeded: { id: "conversation.tool.succeeded" },
  failed: { id: "conversation.tool.failed" },
};
