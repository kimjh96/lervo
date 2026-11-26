# `terminal.context.base_delivered`

[ADR-0645](../../../../../decisions/execution/providers/hooks/0645-answer-an-unserved-prompt-from-the-cached-base.md) lets the terminal hook launcher answer a prompt from the checkout's cached base when the resident context server cannot take it. Schema 14 adds this event, which records that it happened. Schemas 1 through 13 reject the type.

## Fields

All three fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `reason`: why the server did not take the prompt. `no_server` means no socket existed, `unreachable` means the socket did not accept or answer in time, and `declined_busy` means the server was holding another hook. The other offer outcomes run the hook in its own process and never produce this event.
- `cacheAgeMilliseconds`: how old the cached base was when the launcher printed it, an integer from 0 to 1,800,000. The launcher prints no base older than 30 minutes.
- `deliveredAt`: when the launcher printed it, taken from its marker's name.

## Envelope

The context server records the event, never the launcher. The launcher leaves a private marker. On the next served prompt for the same checkout, the server turns each marker into one event with `actor.kind: system`. Each event gets a random `<id>`, written into its marker before the record, which names the event, its `run_basedelivery_<id>` run, and its `ses_basedelivery_<id>` session. So it is never attributed to the session that was served, and a marker that survived its record is not recorded twice. It carries no prompt, path, provider session, or turn identity.

## Failure meaning

- The writer records the event only at schema 14 or later. Below 14, the server removes markers without recording them.
- A marker older than 24 hours, a malformed one, or one whose reason or age falls outside the closed shape is removed without being recorded. It never fails the served prompt.
- Markers are recorded only when the same checkout is served again. A served prompt removes markers older than 24 hours at most hourly, whatever checkout they name, so a count of these events is a lower bound.
- A store that cannot record leaves the markers for a later prompt.
- The server leaves an empty marker younger than 10 seconds alone, because the launcher may still be writing it.
- A turn answered this way records no prepared context, and its Stop records nothing. This event is the only trace that the turn happened, unless it follows an interrupted turn, whose settlement at the next prepared prompt includes its edits.
