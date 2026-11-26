// The catalog's entries for how the interface shows status, waiting, and change.
import type { Entry } from "./entries";
import { PresenceDemo, ViewPresenceDemo } from "./demos";
import { StatusDot } from "../src/ui/StatusDot";
import { Waiting } from "../src/ui/Waiting";
import { WorkingLine } from "../src/ui/WorkingLine";

export const feedbackEntries: readonly Entry[] = [
  {
    module: "StatusDot",
    name: "Status dot",
    purpose: "A workspace's live status, with a text equivalent.",
    use: ["Working and needs-you only; finished work shows no dot"],
    avoid: ["Decoration", "Any status without an accessible name"],
    variants: [
      { name: "Working", render: () => <StatusDot tone="working" label="Working" /> },
      { name: "Needs you", render: () => <StatusDot tone="attention" label="Needs you" /> },
    ],
  },
  {
    module: "WorkingLine",
    name: "Working line",
    purpose: "What the agent is doing right now, at the end of the conversation.",
    use: ["The open conversation while its agent works, or while the core creates its workspace"],
    avoid: [
      "Status of a workspace that is not open",
      "Progress with a known end",
      "A wait for the person's own action: use Waiting",
    ],
    variants: [{ name: "Default", render: () => <WorkingLine label="Writing a reply" /> }],
  },
  {
    module: "Presence",
    name: "Presence",
    purpose:
      "The motion of anything a view shows only sometimes: it fades in over motion.duration.enter and out over motion.duration.leave, so nothing pops in or vanishes.",
    use: [
      "A notice, an inline error, the working line, a wait, or a control the core enables",
      "Every element that comes and goes, unless a motion comment names another catalog row",
    ],
    avoid: [
      "Whole views: use ViewPresence",
      "Rows that leave a list: keep them with useDeparting, so they fade out where they were",
    ],
    variants: [{ name: "Leaving", render: () => <PresenceDemo /> }],
  },
  {
    module: "ViewPresence",
    name: "View presence",
    purpose:
      "The main area's change of views: the old view fades out over motion.duration.leave as a still copy of how it last looked, and the new view fades in over motion.duration.enter, starting halfway through.",
    use: ["The main area, between the start screen and a workspace, and between workspaces"],
    avoid: [
      "A change within one view, such as a button that becomes its wait: use Presence",
      "Content whose leaving copy must stay interactive: the copy takes no clicks",
    ],
    variants: [{ name: "Changing views", render: () => <ViewPresenceDemo /> }],
  },
  {
    module: "Waiting",
    name: "Waiting",
    purpose:
      "What Lervo is doing, where the wait happens: in place of the control an action came from, where a view's content will appear, or in the connection status. It shows after motion.duration.wait.",
    use: [
      "An action the person took, named step by step, such as removing a workspace",
      "A view whose content is opening, such as a conversation",
      "Reaching the session host",
    ],
    avoid: [
      "An agent's work: use WorkingLine",
      "Paging within a view: the view keeps its place and the page joins when it arrives",
      "Text with an ellipsis, Loading, or Please wait",
      "A spinner, a placeholder that looks like data, or a control left disabled beside it",
    ],
    variants: [
      { name: "An action's step", render: () => <Waiting label="Stopping the session" /> },
      { name: "A view opening", render: () => <Waiting label="Opening the conversation" /> },
    ],
  },
];
