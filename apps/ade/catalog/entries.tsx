// The catalog's entries: every shared component in every variant and state, with its usage. It
// is the owner's review surface and the source of the site's live examples (ADE design system,
// "Components"). A new component or variant joins here before it ships.
import type { ReactNode } from "react";

import { Button } from "../src/ui/Button";
import { FloatingButton } from "../src/ui/FloatingButton";
import { IconButton } from "../src/ui/IconButton";
import { ArrowUpIcon, ChevronDownIcon, PlusIcon, StopIcon, TrashIcon } from "../src/ui/icons";
import { InlineAlert } from "../src/ui/InlineAlert";
import { Kbd } from "../src/ui/Kbd";
import { ListRow } from "../src/ui/ListRow";
import { PaneHeader } from "../src/ui/PaneHeader";
import { StatusDot } from "../src/ui/StatusDot";
import { Waiting } from "../src/ui/Waiting";
import { WorkingLine } from "../src/ui/WorkingLine";
import { CardDemo, PresenceDemo, SegmentedDemo, SelectDemo, ViewPresenceDemo } from "./demos";

export interface Variant {
  readonly name: string;
  readonly render: () => ReactNode;
}

export interface Entry {
  /** The component's module in `src/ui/`. */
  readonly module: string;
  readonly name: string;
  readonly purpose: string;
  readonly use: readonly string[];
  readonly avoid: readonly string[];
  readonly variants: readonly Variant[];
}

export const entries: readonly Entry[] = [
  {
    module: "InputCard",
    name: "Input card",
    purpose:
      "A text field and its actions on one raised card; Enter submits, Shift+Enter breaks a line.",
    use: [
      "The instruction of new work (input, stacked)",
      "A reply over a conversation (floating, inline)",
    ],
    avoid: ["Short single-value fields", "Forms with several fields"],
    variants: [
      { name: "Input, stacked", render: () => <CardDemo surface="input" layout="stacked" /> },
      { name: "Floating, inline", render: () => <CardDemo surface="floating" layout="inline" /> },
    ],
  },
  {
    module: "ListRow",
    name: "List row",
    purpose:
      "A row of a navigation list, with an optional icon before and a status or shortcut after.",
    use: ["Workspaces and other places the person moves between"],
    avoid: ["Actions that change data", "Rows that need more than one line"],
    variants: [
      {
        name: "States",
        render: () => (
          <div style={{ width: "var(--layout-sidebar-width)" }}>
            <ListRow
              current
              label="New work"
              leading={<PlusIcon size="md" />}
              trailing={<Kbd>⌘N</Kbd>}
              onClick={() => undefined}
            />
            <ListRow
              current={false}
              label="Fix the flaky test"
              trailing={<StatusDot tone="working" label="Working" />}
              onClick={() => undefined}
            />
            <ListRow current={false} quiet label="Tidy the docs" onClick={() => undefined} />
          </div>
        ),
      },
    ],
  },
  {
    module: "Button",
    name: "Button",
    purpose: "A secondary action in a bar: quiet text or a quiet icon, or an outlined answer.",
    use: [
      "A header control, such as removing the workspace, as a quiet icon with a name",
      "The answers to a question in a bar: the action outlined, the safe answer quiet and focused",
    ],
    avoid: [
      "The one primary action of an input card, which is an icon button",
      "The failure color for an action that deletes something",
    ],
    variants: [
      {
        name: "Quiet icon",
        render: () => (
          <Button variant="quiet" label="Remove workspace" onClick={() => undefined}>
            <TrashIcon size="md" />
          </Button>
        ),
      },
      {
        name: "Question answers",
        render: () => (
          <span style={{ display: "inline-flex", gap: "var(--space-6)" }}>
            <Button variant="outlined" onClick={() => undefined}>
              Remove
            </Button>
            <Button variant="quiet" onClick={() => undefined}>
              Cancel
            </Button>
          </span>
        ),
      },
      {
        name: "Disabled",
        render: () => (
          <Button variant="outlined" disabled onClick={() => undefined}>
            Remove
          </Button>
        ),
      },
    ],
  },
  {
    module: "FloatingButton",
    name: "Floating button",
    purpose: "A small pill that floats over content on glass and fades in when it appears.",
    use: ["A way back to where the content continues, such as Jump to latest"],
    avoid: ["Primary actions", "Anything that must stay on screen"],
    variants: [
      {
        name: "Default",
        render: () => <FloatingButton onClick={() => undefined}>Jump to latest</FloatingButton>,
      },
    ],
  },
  {
    module: "IconButton",
    name: "Icon button",
    purpose: "The one action of an input card, such as send, shown as an icon with a name.",
    use: ["The primary action inside an input card", "A control whose icon is understood at once"],
    avoid: [
      "A second primary action on the same surface",
      "An action that needs words to be understood",
    ],
    variants: [
      {
        name: "Primary",
        render: () => <IconButton label="Send" icon={<ArrowUpIcon size="lg" />} />,
      },
      {
        name: "Disabled",
        render: () => <IconButton label="Send" icon={<ArrowUpIcon size="lg" />} disabled />,
      },
      {
        name: "Stop, while the agent works",
        render: () => <IconButton label="Stop" icon={<StopIcon size="lg" />} />,
      },
    ],
  },
  {
    module: "Select",
    name: "Select chip",
    purpose: "A compact native chooser inside a card's action bar.",
    use: [
      "Choosing among a few known options without leaving the card",
      "Showing an option that exists but cannot be chosen now, disabled, with the reason in its text",
    ],
    avoid: ["A form field that needs a visible label", "More than a short list of options"],
    variants: [{ name: "Default", render: () => <SelectDemo /> }],
  },
  {
    module: "SegmentedControl",
    name: "Segmented control",
    purpose: "A choice between a few views of the same thing.",
    use: ["Switching how one object is shown, such as a list or a grid of the same items"],
    avoid: ["Navigation between different objects", "More than three options"],
    variants: [
      { name: "Default", render: () => <SegmentedDemo /> },
      { name: "Disabled while switching", render: () => <SegmentedDemo disabled /> },
    ],
  },
  {
    module: "Kbd",
    name: "Shortcut label",
    purpose: "The keyboard shortcut of the action it sits beside.",
    use: ["Beside an action that has a shortcut"],
    avoid: ["Explaining shortcuts in prose", "Decoration without a working shortcut"],
    variants: [{ name: "Default", render: () => <Kbd>⌘N</Kbd> }],
  },
  {
    module: "InlineAlert",
    name: "Inline alert",
    purpose: "A failure shown where it happened, with its code.",
    use: ["A request or stage that failed in this place", "Always with the protocol code"],
    avoid: ["Warnings that need no action", "Success messages"],
    variants: [
      {
        name: "Note size",
        render: () => (
          <InlineAlert size="note">Lervo could not start the work (worktree_locked).</InlineAlert>
        ),
      },
      {
        name: "Meta size",
        render: () => (
          <InlineAlert size="meta">The reply did not reach the agent (session_ended).</InlineAlert>
        ),
      },
      {
        name: "Caption size",
        render: () => (
          <InlineAlert size="caption">
            The switch did not happen (session_stop_timeout).
          </InlineAlert>
        ),
      },
    ],
  },
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
  {
    module: "PaneHeader",
    name: "Pane header",
    purpose: "The main area's title bar, which also moves the window.",
    use: ["The top of the start-free main area: a workspace or the work being started"],
    avoid: ["Section titles inside a pane"],
    variants: [
      {
        name: "With controls",
        render: () => (
          <PaneHeader title="Fix the flaky test" detail="lervo/fix-flaky">
            <SegmentedDemo />
          </PaneHeader>
        ),
      },
    ],
  },
  {
    module: "icons",
    name: "Icons",
    purpose: "Icons on a 24 px grid with 2 px round strokes, in the current text color.",
    use: ["Size sm beside caption text, md in rows, lg in buttons"],
    avoid: ["Emoji", "An icon-only control without an accessible name"],
    variants: [
      {
        name: "Sizes",
        render: () => (
          <span style={{ display: "inline-flex", gap: "var(--space-12)", alignItems: "center" }}>
            <ChevronDownIcon size="sm" />
            <PlusIcon size="md" />
            <ArrowUpIcon size="lg" />
            <StopIcon size="lg" />
            <TrashIcon size="md" />
          </span>
        ),
      },
    ],
  },
];
