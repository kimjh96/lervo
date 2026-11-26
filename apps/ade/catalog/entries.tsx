// The catalog's entries: every shared component in every variant and state, with its usage. It
// is the owner's review surface and the source of the site's live examples (ADE design system,
// "Components"). A new component or variant joins here before it ships.
import type { ReactNode } from "react";

import { feedbackEntries } from "./entries-feedback";

import { Button } from "../src/ui/Button";
import { FloatingButton } from "../src/ui/FloatingButton";
import { IconButton } from "../src/ui/IconButton";
import { ArrowUpIcon, ChevronDownIcon, PlusIcon, StopIcon, TrashIcon } from "../src/ui/icons";
import { InlineAlert } from "../src/ui/InlineAlert";
import { Kbd } from "../src/ui/Kbd";
import { Mark } from "../src/ui/Mark";
import { ListRow } from "../src/ui/ListRow";
import { PaneHeader } from "../src/ui/PaneHeader";
import { SectionHeading } from "../src/ui/SectionHeading";
import { StatusDot } from "../src/ui/StatusDot";
import { WorkingLabel } from "../src/ui/WorkingLabel";
import {
  AttachmentTrayDemo,
  CardDemo,
  FileChipDemo,
  ImageViewerDemo,
  PopoverMenuDemo,
  SuggestionListDemo,
  SegmentedDemo,
  SelectDemo,
} from "./demos";

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
      {
        name: "Files dragged over the window",
        render: () => <CardDemo surface="floating" layout="inline" dropHint="Drop to attach" />,
      },
    ],
  },
  {
    module: "AttachmentTray",
    name: "Attachment tray",
    purpose:
      "What waits in an input card to go with its text, on one row above the field: image thumbnails that open at full size, then file chips of the same height; each has a remove button on hover and focus.",
    use: ["Images and files pasted or dropped into the reply card or the instruction of new work"],
    avoid: ["Images and files already sent, which show in their message bubble"],
    variants: [{ name: "Images and files", render: () => <AttachmentTrayDemo /> }],
  },
  {
    module: "FileChip",
    name: "File chip",
    purpose:
      "A file attached by path: a type badge, its name, and a quiet line under it; it shows the file in Finder, and a missing file is faint and does not open.",
    use: ["Files waiting in an attachment tray (tray)", "Files a sent message named (message)"],
    avoid: ["Images, which show as themselves", "Links and commands"],
    variants: [
      { name: "Tray", render: () => <FileChipDemo size="tray" /> },
      { name: "Message", render: () => <FileChipDemo size="message" /> },
      { name: "Moved or deleted", render: () => <FileChipDemo size="message" missing /> },
    ],
  },
  {
    module: "ImageViewer",
    name: "Image viewer",
    purpose:
      "One image at full size over the dimmed window; Escape or a click outside closes it, and the arrow keys move between images.",
    use: ["Opening an image from a message bubble or an image tray"],
    avoid: ["Content other than images", "Choices the person must make"],
    variants: [{ name: "Two images", render: () => <ImageViewerDemo /> }],
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
              label={<WorkingLabel title="Fix the flaky test" working="Working" />}
              onClick={() => undefined}
            />
            <ListRow
              current={false}
              label="Review the release"
              trailing={<StatusDot label="Needs you" />}
              onClick={() => undefined}
            />
            <ListRow current={false} label="Tidy the docs" onClick={() => undefined} />
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
    module: "PopoverMenu",
    name: "Menu",
    purpose: "A short list of named actions, hung below the control that opened it.",
    use: ["A control whose actions open the interface's own windows, such as Add Project"],
    avoid: ["A project's context menu, which is the system's", "More than about seven items"],
    variants: [{ name: "Add Project", render: () => <PopoverMenuDemo /> }],
  },
  {
    module: "SuggestionList",
    name: "Suggestions",
    purpose:
      "What the person is typing can become, such as the agents an @ mentions, hung above the caret while the field keeps the focus.",
    use: ["Completing a token typed in a field, where typing narrows the list"],
    avoid: ["Actions, which a menu names", "Choices that do not depend on what is typed"],
    variants: [
      {
        name: "Mention",
        render: () => <SuggestionListDemo />,
      },
    ],
  },
  {
    module: "Mark",
    name: "Identity mark",
    purpose: "A project's or an agent's logo, or its first letter on a color chosen by its ID.",
    use: ["Beside the name of a project or an agent, which carries the accessible name"],
    avoid: ["Standing alone without the name", "Status or decoration"],
    variants: [
      {
        name: "First letter, list",
        render: () => <Mark id="prj_lervo" name="lervo" src={null} size="sm" />,
      },
      {
        name: "First letter, switcher",
        render: () => <Mark id="prj_argo" name="Argo" src={null} size="md" />,
      },
      { name: "Hangul", render: () => <Mark id="prj_todo" name="할 일 앱" src={null} size="md" /> },
      {
        name: "Agent",
        render: () => <Mark id="agt_elio" name="Elio" src={null} size="md" shape="round" />,
      },
    ],
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
  ...feedbackEntries,
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
          <PaneHeader title="Fix the flaky test">
            <SegmentedDemo />
          </PaneHeader>
        ),
      },
    ],
  },
  {
    module: "SectionHeading",
    name: "Section heading",
    purpose: "The heading of a sidebar section, with an optional quiet plus that adds to it.",
    use: ["Agents and Conversations in the sidebar"],
    avoid: ["The main area's title, which is the pane header", "More than one action"],
    variants: [
      {
        name: "With and without adding",
        render: () => (
          <div style={{ width: "var(--layout-sidebar-width)" }}>
            <SectionHeading
              label="Agents"
              add={{ label: "Hire an Agent", onClick: () => undefined }}
            />
            <SectionHeading label="Conversations" />
          </div>
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
