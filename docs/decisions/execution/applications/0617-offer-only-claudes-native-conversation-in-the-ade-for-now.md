# ADR-0617: Offer only Claude's native conversation in the ADE for now

Status: `accepted`
Decision date: 2026-11-23
Amends: [ADR-0613](0613-host-provider-clis-in-a-first-party-development-environment.md) (the ADE offers the native conversation only, and Claude Code only, for now)

## Context

ADR-0613 gave the ADE two conversation modes: the native conversation, which Lervo renders from the provider's structured stream, and the CLI conversation, the provider's own terminal interface in xterm.js.

On 2026-11-23 the owner used the CLI conversation on the Mac and found it hard to use:

- Hangul typed through the input method lost its first syllable: "테스트" arrived as "ㅌ스트".
- Hangul left a gap in each of its two cells. The terminal's cell width comes from the Latin face, and no Hangul face on a stock Mac draws at exactly two Latin widths. xterm.js measures the cell with an `OffscreenCanvas`, which did not take an installed Korean coding face as monospace.
- The terminal drew its background as transparent black for the window glass. Inverse text, dim text, and the answer to a program's background query all became black. Claude Code chose its dark theme on a light window, and fixing the background made dim text nearly invisible on the glass.

The owner then asked why the ADE needs a terminal at all. Its uses are:

- providers without the native conversation, which today means Codex;
- CLI features the native conversation does not show yet, such as slash commands;
- a way through when a provider's stream changes.

The owner cancelled the Codex subscription on 2026-11-22, so no provider without the native conversation is in use.

## Decision

- **The ADE offers the native conversation only.** The terminal view, the conversation mode switch, xterm.js, the terminal palette, and the shell's terminal relay leave the ADE.
- **The session host keeps its CLI mode.** Its PTY, scrollback, and terminal frames stay. Its own tests and load examples exercise them, and nothing in the ADE asks for them. The terminal can return by restoring the interface and the shell relay, without rebuilding the hardest part.
- **Former terminal workspaces still open.** A workspace last opened in the terminal opens in the native conversation, and the core resumes the same session.
- **Claude Code only, for now.** The start screen starts Claude Code without an agent choice. When the provider registry reaches the interface, the interface offers the providers whose capabilities include the native conversation. Claude Code is the only one today, and no screen names a provider.
- **The core keeps both modes.** `lervo workspace start` and `lervo workspace open --mode cli` still prepare CLI launches, and the Codex hosted adapter stays, so no CLI release follows from this decision.
- **When the terminal returns.** It returns in the same direction: a terminal inside the ADE, not a hand-off to another terminal application. The removed code is in Git history, last on `main` at `ed465c6358f1`, and a fix for the background is on the unmerged commit `fd47d786e`. Before it ships again, it needs:
  - the real background color behind its transparency, with minimum contrast;
  - dim text that stays readable on the glass;
  - input-method composition verified with Korean on WKWebView;
  - a monospace face that draws Hangul at exactly two cells.

## Consequences

- The ADE loses the CLI conversation, and with it Codex and CLI features the native conversation lacks, until each returns.
- The start screen's JavaScript loses the terminal's lazy chunk, 115 KB gzip, and the design system loses the terminal palette and surface.
- The CLI conversation's budgets, such as input latency during a terminal flood, no longer apply to the ADE.

## Verification

- The interface tests pass without the terminal, and a test reopens a former terminal workspace's session in the native conversation.
- The start screen loads 98.7 KB gzip of its 120 KB budget, and the largest lazy chunk is the Markdown renderer at 16 KB.
- The shell builds without its terminal relay, and clippy passes.
