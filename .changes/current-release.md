<!-- lervo-release package="@lervo/cli" version="0.69.1" schema="1" -->

## What's changed

- A conversation read back from Claude Code's transcript leaves out turns Claude Code itself sent the agent, such as a background task's notification, instead of showing them as the person's message.
- A host whose delegated provider is not admitted now reports provider_not_admitted, not knowledge_authority_unavailable, and looks at ownership again when that hour-old record lapses, so upgrade stages stop waiting as Lervo debt for an unrelated change.
- A resumed provider-probe now clears that provider's recorded failures host-wide and wakes ineligible repositories, and an empty Git index lock older than 10 minutes with no git running is reported as git_index_lock_stale with its path for the owner to remove.
- Keep CAS retention running on an idle or provider-waiting host until the store settles, with time-boxed slices about every 30 seconds
