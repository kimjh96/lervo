// The catalog's entries: every shared component in every variant and state, with its usage. It
// is the owner's review surface and the source of the site's live examples (ADE design system,
// "Components"). A new component or variant joins here before it ships.
import type { ReactNode } from "react";
import { useState } from "react";

import { IconButton } from "../src/ui/IconButton";
import { ArrowUpIcon, ChevronDownIcon, PlusIcon } from "../src/ui/icons";
import { InlineAlert } from "../src/ui/InlineAlert";
import { Kbd } from "../src/ui/Kbd";
import { PaneHeader } from "../src/ui/PaneHeader";
import { SegmentedControl } from "../src/ui/SegmentedControl";
import { Select } from "../src/ui/Select";
import { StatusDot } from "../src/ui/StatusDot";
import { WorkingLine } from "../src/ui/WorkingLine";

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

function SegmentedDemo(props: { disabled?: boolean }) {
  const [value, setValue] = useState<"native" | "cli">("native");
  return (
    <SegmentedControl
      label="Show as"
      options={[
        { value: "native", text: "Conversation" },
        { value: "cli", text: "Terminal" },
      ]}
      value={value}
      onChange={setValue}
      disabled={props.disabled ?? false}
    />
  );
}

function SelectDemo() {
  const [value, setValue] = useState("claude");
  return (
    <Select
      label="Agent"
      value={value}
      options={[
        { value: "claude", text: "Claude Code" },
        { value: "codex", text: "Codex" },
      ]}
      onChange={setValue}
    />
  );
}

export const entries: readonly Entry[] = [
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
    ],
  },
  {
    module: "Select",
    name: "Select chip",
    purpose: "A compact native chooser inside a card's action bar.",
    use: ["Choosing among a few known options without leaving the card"],
    avoid: ["A form field that needs a visible label", "More than a short list of options"],
    variants: [{ name: "Default", render: () => <SelectDemo /> }],
  },
  {
    module: "SegmentedControl",
    name: "Segmented control",
    purpose: "A choice between a few views of the same thing.",
    use: ["Switching how one object is shown, such as conversation or terminal"],
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
    use: ["The open conversation while its agent works"],
    avoid: ["Status of a workspace that is not open", "Progress with a known end"],
    variants: [{ name: "Default", render: () => <WorkingLine label="Writing a reply" /> }],
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
          <PaneHeader title="Fix the flaky test" detail="lervo/fix-flaky" arrive={false}>
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
          </span>
        ),
      },
    ],
  },
];
