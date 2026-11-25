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

Every wait in Lervo follows one system, so the person always reads a wait the same way. It applies to every new feature: a wait that fits none of the kinds below changes this section before it ships.

**Principles**

- **Name the activity, where it happens.** A wait says what Lervo is doing, in the place the person is looking: "Stopping the session" in place of the control they pressed, "Opening the conversation" where the conversation will appear. The rest of the window stays usable. No modal, overlay, or full-window cover.
- **Say nothing for short waits.** A wait shows only after `motion.duration.wait` (300 ms). Most local actions end sooner, and a line that flashes for a few frames reads as a fault. The first connection waits `motion.duration.waitLaunch` (1,000 ms), because the kept lists show meanwhile.
- **One look.** The words are tertiary, and a band of `color.text.highlight` sweeps across them over `motion.duration.shimmer`: brighter words in dark mode, lighter words in light mode, so it reads as light passing in both. A darker band in light mode barely showed (2026-11-24). Under reduced motion the words stay still. Lervo has no spinner, no progress ring, and no placeholder that looks like data.
- **Steps, not a stalled line.** An action with several steps names each one as it begins, in the same place: "Stopping the session", then "Removing the workspace".
- **The control gives way.** Pressing a control answers at once: the control, and an offer or question it belongs to, fades out. Its wait takes the same place only if the action outlasts `motion.duration.wait`, so a fast action never flashes a loading line, and the result follows there. A disabled control is never left beside it.
- **One wait per place.** Two waits never stack in one place: while a session host restart runs, its line stands for the connection status, which hides until the restart ends.
- **The result is the confirmation.** A wait ends in the result itself, such as the row leaving the list, never a "Done" message. When the screen shows no sign of the result, such as a restarted session host, a past-tense line states it in place for `motion.duration.settle` and then leaves: "Restarted the session host". A failure ends the wait with the failure where it happened, as "Failures" defines.
- **Nothing pops in or vanishes.** A notice, a line, or a wait that comes or goes while the person watches fades in and out (motion, "Coming and going").

**Kinds and components**

| Kind                      | What the ADE shows                                                                                                                 | Component     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| The agent works           | The working line at the end of the conversation names the activity, with the working dot: "Writing a reply", "Read is running".    | `WorkingLine` |
| The core creates work     | The pending workspace at once, with the instruction as its first message and "Creating the workspace" as its working line.         | `WorkingLine` |
| The person's action       | The wait replaces the control the action came from and names each step: removing a workspace, restarting the session host.         | `Waiting`     |
| A view opens              | Where the content will appear: "Opening the conversation". A conversation seen recently shows its last window at once instead.     | `Waiting`     |
| Reaching the session host | The connection status in the workspace list footer: "Connecting to this computer", "Reconnecting". Open views stay.                | `Waiting`     |
| Paging within a view      | Nothing: the view keeps its place, and the page joins when it arrives.                                                             | None          |
| Loading a list            | The last list stays. A first load shows nothing until it arrives, never a placeholder that looks like data.                        | None          |
| Known progress            | Determinate progress that animates `transform: scaleX`, with the count or size in words. It ships with its first use.              | Not yet       |
| Launching                 | The window opens with the Lervo mark until the first lists load, the session host is unavailable, or the cold-start budget passes. | Launch view   |

**Other situations**

| Situation                | What the ADE shows                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A reply streaming        | The text flows in at the pace the motion principles set. The working line names the activity.                                                               |
| Session host unavailable | The connection status names it and stays still: it is a failure, not a wait. Commands that need the session host fail with their code where they were made. |
| An older installed Lervo | The start screen starts the core's default agent and says that updating Lervo adds the choice. Nothing else changes.                                        |

**Copy.** A wait is a present participle and its object, in sentence case, without a period: "Opening the conversation". It never uses an ellipsis, "Loading", or "Please wait". The message catalog test rejects all three.

- **No standing explanations.** A screen the person sees every time says nothing they already know. The start screen shows the question and the instruction card; it adds a note only when something is missing, such as a registered repository, or when an older Lervo limits the choice. Sending shows what Lervo does: the pending workspace names it.
- **Empty is a fact, not a failure.** An empty list says what is missing and how to add it, such as registering a repository. An unknown state never reads as empty.

### Navigation and selection

- **The first click acts.** A click on the Lervo window while another app is in front presses what it lands on. Such a click reaches the page broken in one of two shapes, and the page completes it unless a real `click` arrives first. In the first, WebKit spends the whole click on bringing the window forward, so the shell reports an activation that followed a left mouse press within half a second, with the pointer over the window's content, and the page presses the control there. In the second, recorded from the owner's own clicks, WebKit hands the page the click's release before its press, so no `click` follows, and the page presses the control where the press landed. A click on empty space or the title bar presses nothing; Command-Tab and the Dock press nothing.
- **The workspace list** is the one navigation. Selecting a row opens that workspace at once; selecting the open one changes nothing.
- **The header** names the workspace by its title. The branch is a detail the person rarely needs, so it sits behind a quiet branch icon: hovering or focusing names it, and pressing copies it.
- **What stays, stays still.** The workspace list, the header, and the reply card keep their places through every change, as the motion principles require.
- **New work.** "New work" and its shortcut open the start screen with the instruction focused.
- **Narrow and zoomed windows.** Below the breakpoint, the workspace list narrows to `layout.sidebarMinWidth` instead of hiding, so no navigation disappears. The macOS window controls keep the list's strip. Titles truncate before controls do.
- **One conversation.** The ADE shows the native conversation only, so the header holds no mode switch ([ADR-0617](../../../decisions/execution/applications/0617-offer-only-claudes-native-conversation-in-the-ade-for-now.md)). A workspace last opened in the terminal opens in the native conversation.

### Keyboard

- **Every action has a keyboard path.** Shortcuts use the platform's command modifier, and `Kbd` shows them beside the action they run.
- **Shortcuts.** `⌘N` opens new work. Enter sends from an input card, and Shift+Enter adds a line. Escape in the reply card stops the agent's turn while it works. Input-method composition never sends or stops.
- **Focus order** follows the visual order: the workspace list, the header, the content, then the input card.
- **Focus on open.** The start screen focuses its instruction when it opens and on each "New work". An overlay, when one arrives, returns focus to where it was when it closes.
- **Full keyboard access.** macOS moves Tab between buttons only when the person turns on keyboard navigation, as in every Mac app. Text fields and selects take Tab always.
- **Focus is always visible.** A control draws `focus.ring` around itself, and a container that holds the focused field, such as an input card or the conversation frame, draws it for the field.

### Input

- **Drafts persist.** An unsent instruction or reply survives switching workspaces and restarting the app, per workspace.
- **Sending.** The send control enables only when there is something to send. Sending clears the field at once, and a failed send puts the text back with its failure, so nothing is lost.
- **Stopping.** While the agent works, the empty reply card's button is Stop, a filled square; its icon changes in place, and typed text turns it back into send. A failed stop shows under the card, and the agent keeps working.
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
- **Waiting** names the activity: "Writing a reply", "Creating the workspace", "Stopping the session". "Waiting" in the patterns defines where it shows.
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
