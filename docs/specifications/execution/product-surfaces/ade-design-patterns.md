# Lervo ADE patterns and content

Status: `active`
As of: 2026-11-23

This specification is the patterns and content chapter of the [design system](ade-design-system.md). A pattern says how the ADE handles one recurring situation, with the components, copy, and motion it uses. Content rules say how the ADE writes. Both follow the design language. Components and their rules are in the design system, colors and type in the [visual language](ade-visual-language.md), and timing in the [motion principles](ade-motion.md).

## Patterns

### Status

- **Words.** A workspace or session is "Working", "Needs you", or "Done". The workspace list shows them for every workspace, and the working line names the activity in the open conversation, such as "Writing a reply".
- **Not by color alone.** `StatusDot` carries an accessible name, and needs-you is a step larger than working.
- **Where.** Status lives in the workspace list and the working line, never in the header, so it never appears twice.
- **Changes.** The needs-you dot fades in once and then stays still. A finished status is removed, with no celebration.
- **Notifications.** A desktop notification fires only when a workspace the person is not watching starts needing them or finishes.

### Failures

- **Code, then words.** Every failure shows its stable code with a plain explanation and the next step, in `InlineAlert`, where it happened. The interface never replaces a failure with a state of its own, such as an empty list.
- **Placement.**
  - A failed start returns to the start screen with the instruction intact.
  - A failed mode switch shows in the header.
  - A failed send shows under the reply card and keeps the text.
  - A list that failed to reload keeps the last list and says so.
- **Parameters.** When the session host or the core names a stage or a reason, such as `stage: workstream` or `reason: command_unsupported`, the explanation uses it.
- **Recovery.** A failure keeps what the person made, so trying again is one action. The ADE never offers a retry that cannot succeed.

### Waiting

| Situation                | What the ADE shows                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launching                | The window opens with the Lervo mark until the first lists load, the session host is unavailable, or the cold-start budget passes (motion, "Launch"). |
| Loading a list           | The last list stays. A first load shows nothing until it arrives, never a placeholder that looks like data.                                           |
| Starting work            | The pending workspace at once, with the instruction as its first message and "Creating the workspace" as its working line.                            |
| A reply streaming        | The text flows in at the pace the motion principles set. The working line names the activity.                                                         |
| Reconnecting             | The connection status in the workspace list footer says so. Open views stay, and nothing claims the connection has returned until it has.             |
| Session host unavailable | The connection status names it. Commands that need the session host fail with their code where they were made.                                        |
| An older installed Lervo | The start screen starts the core's default agent and says that updating Lervo adds the choice. Nothing else changes.                                  |

- **Empty is a fact, not a failure.** An empty list says what is missing and how to add it, such as registering a repository. An unknown state never reads as empty.

### Navigation and selection

- **The workspace list** is the one navigation. Selecting a row opens that workspace at once; selecting the open one changes nothing.
- **What stays, stays still.** The workspace list, the header, and the reply card keep their places through every change, as the motion principles require.
- **New work.** "New work" and its shortcut open the start screen with the instruction focused.
- **Narrow and zoomed windows.** Below the breakpoint, the workspace list narrows to `layout.sidebarMinWidth` instead of hiding, so no navigation disappears. The macOS window controls keep the list's strip. Titles truncate before controls do.
- **Modes.** The header switches between the conversation modes the workspace's provider offers, and hides the switch when there is only one.

### Keyboard

- **Every action has a keyboard path.** Shortcuts use the platform's command modifier, and `Kbd` shows them beside the action they run.
- **Shortcuts.** `⌘N` opens new work. Enter sends from an input card, and Shift+Enter adds a line. Input-method composition never sends.
- **Focus order** follows the visual order: the workspace list, the header, the content, then the input card.
- **Focus on open.** The start screen focuses its instruction when it opens and on each "New work". An overlay, when one arrives, returns focus to where it was when it closes.
- **Full keyboard access.** macOS moves Tab between buttons only when the person turns on keyboard navigation, as in every Mac app. Text fields and selects take Tab always.
- **Focus is always visible.** A control draws `focus.ring` around itself, and a container that holds the focused field, such as an input card or the conversation frame, draws it for the field.

### Input

- **Drafts persist.** An unsent instruction or reply survives switching workspaces and restarting the app, per workspace.
- **Sending.** The send control enables only when there is something to send. Sending clears the field at once, and a failed send puts the text back with its failure, so nothing is lost.
- **Choices.** A `Select` keeps an option that cannot be chosen now visible and disabled, with the reason in its text, such as "Codex (not installed)".

### Notifications and notices

- **Desktop notifications** follow the status pattern and carry the workspace's title.
- **Lervo notices** in a conversation state a condition and what continues, fade in once, and never interrupt.

### Patterns still to come

These patterns are defined with the features that need them:

- **Evidence and verification.** The states `selected`, `loaded`, `injected`, `referenced`, and `used` never look promoted, and missing telemetry reads as unknown.
- **Undo and after-the-fact notices.** A consequential effect is reversible and reported after the fact, never gated by an approval dialog.
- **Overlays:** the command palette, menus, and popovers.
- **Settings, first run, and more than one host.**

## Content

### Voice and tone

- **Voice.** Plain, concrete, and calm. Lervo states what happened and what it verified, in the person's terms, without celebration or alarm.
- **Success** states the result and its limit: "3 checks passed", "1 file changed, not committed".
- **Waiting** names the activity: "Writing a reply", "Creating the workspace".
- **Failure** states what failed, its code, and the next step.
- **A notice** states the condition and what continues.

### Glossary

The interface and the documentation use these words with these meanings, and no synonyms.

| Term         | Meaning                                                                                              | Not                        |
| ------------ | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| Workspace    | A worktree on its own branch, with its workstream and its agent session                              | Project, folder            |
| Workstream   | Lervo's durable record of one bounded piece of work: its objective, checkpoints, and next actions    | Task, ticket               |
| Repository   | A Git repository registered with Lervo on this host                                                  | Project, repo (in copy)    |
| Agent        | The provider CLI that does the work in a workspace, named by its product name, such as "Claude Code" | Model, bot, assistant      |
| Session      | One run of an agent in a workspace, which the session host keeps alive                               | Chat, thread               |
| Conversation | A session shown as messages, the native conversation                                                 | Chat                       |
| Terminal     | A session shown as the agent's own terminal interface, the CLI conversation                          | Console, shell (in copy)   |
| Instruction  | What the person asks a workspace's agent to do                                                       | Prompt, query              |
| Evidence     | What Lervo recorded about what happened, with its source                                             | Logs, proof                |
| Verification | A check Lervo ran and its result                                                                     | Test (unless it is a test) |

### Copy rules

- **Messages.** Every string comes from the message catalog with a static ID and a description for translators. Provider names come from the core's registry and are never translated.
- **Case and verbs.** Sentence case and concrete verbs. Buttons name their action: "Start", not "OK".
- **Failures.** The pattern is "Lervo could not [action][ at the [stage] stage]." followed by the code. The code is always present.
- **Empty states** say what is missing and the one action that adds it.
- **Shortcut labels** use the platform's symbols on macOS and words elsewhere, from the catalog.
- **Writing policy.** The `writing_en-human` policy applies, and the visual language's "Interface copy" section has the details.

### Localization

- **ICU messages.** Plurals and selects live in the message, never in code, and no string is built by joining fragments.
- **Expansion.** Layouts leave room for text 40% longer than English, and truncation keeps controls whole.
- **Direction.** Styles use logical properties, so a right-to-left catalog needs no layout change.
- **Fallback.** A locale without a catalog falls back to English.

### Accessible names

- **Controls** without visible text carry an accessible name from the catalog, such as "Start" on the send button.
- **Regions.** The workspace list is a navigation landmark and the content is the main landmark.
- **Live updates.**
  - The conversation is a polite log.
  - The working line and the connection status are status regions.
  - An inline failure is an alert.
- **Decoration** carries no name: the launch view and icons beside text are hidden from assistive technology.
