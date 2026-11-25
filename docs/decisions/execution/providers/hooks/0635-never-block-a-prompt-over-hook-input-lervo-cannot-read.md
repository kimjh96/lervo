# ADR-0635: Never block a prompt over hook input Lervo cannot read

Status: `accepted`
Decision date: 2026-11-26
Amends: [ADR-0531](0531-bound-terminal-hooks-and-retain-degraded-context.md)
Related: [ADR-0539](0539-keep-the-terminal-hook-runtime-host-local-behind-a-tracked-launcher.md)

## Context

ADR-0531 kept rejected hook ingress nonzero: the hook runtime exited 2 when it could not accept the provider's input. Claude Code and Codex both read exit 2 as blocking. A `UserPromptSubmit` that exits 2 drops the owner's message, and a `Stop` that exits 2 forces the agent to continue.

On 2026-11-26 the ADE sent an image-only message through Claude Code's stream-json input. The prompt text was empty, `terminal-hook-input.ts` refused `prompt.trim() === ""` as invalid ingress, and Claude Code dropped the message with "UserPromptSubmit operation blocked by hook". A terminal session never sends empty text, because Claude Code writes `[Image #1]` placeholders for a pasted image. The ADE worked around it by writing the same placeholders.

The same rule refused more than empty text:

- a prompt longer than 64 KiB, such as a long paste;
- input larger than 256 KiB;
- malformed JSON, a missing session coordinate, and an unknown event.

In every one of these cases Lervo, not the owner, failed to read the input, yet the owner's prompt was the thing lost. The repository's operating principle keeps conversation open by default, and Lervo's context is an addition to the prompt, never a gate on it.

## Decision

Lervo never blocks a prompt or forces a Stop to continue over input it cannot read.

- **Empty prompt text is valid.** An image-only or blank message runs the normal prompt path with its empty text. If preparation cannot use the empty text, the existing degraded path answers with the base context and exit 0, as for any preparation failure.
- **A long prompt is cut, not refused.** The hook reads at most the first 64 KiB of prompt text, cut before a split surrogate pair. Retrieval, the query digest, and the owner-turn capture queue see that bounded text; the provider still sends the whole message.
- **Rejected ingress exits 0.** Input that is not JSON, lacks the session coordinate, names an unsupported event, lacks the prompt field, exceeds the 256 KiB input bound, or carries a malformed Stop field still records the failed stage observation with `hook_input_invalid` and unattributed coordinates. The hook then prints `{}` and the fixed message `Lervo terminal integration failed (hook_input_invalid).` to standard error, and exits 0. The provider proceeds without Lervo's context.
- **Integrity failure stays closed.** A launcher or runtime that fails its byte-count, hash, ownership, or symlink checks still exits 2 under ADR-0539. That case means the installed code cannot be trusted, which is a reason to stop; the input cases above mean only that Lervo could not read what the provider sent.

## Consequences

- An owner's prompt reaches the model whenever the provider would have sent it without Lervo.
- A turn whose input was rejected has no prepared context and no turn evidence. Its failed stage observation remains, so `hook_input_invalid` still counts in attention and reports.
- A long prompt's capture covers only its first 64 KiB. An owner rule stated after that point in one very long message is not captured from that prompt.

## Verification

- `apps/cli/test/terminal-hook-input.test.ts`:
  - empty and blank prompts are accepted;
  - a 70,000-character prompt is cut to 65,536 characters;
  - a cut never ends in the first half of a surrogate pair;
  - a prompt hook without a prompt field is still refused.
- `apps/cli/test/terminal-hook-failure-reasons.test.ts`:
  - unreadable JSON, a missing session, and an unknown event each exit 0 with `{}`, the fixed message, and a recorded `hook_input_invalid` observation;
  - an image-only prompt is answered.
- `apps/cli/test/terminal-hook-launcher.test.ts` keeps exit 2 for integrity failures.
