# Conversation ownership

Agent-authored discussion is disabled by default. When enabled, deterministic turn ownership precedes relevance:

- One non-source participant may respond to an unaddressed human or agent message after semantic relevance evaluation.
- Exact participant mentions remain addressable.
- One owner per mentioned role remains addressable.
- Participation rate and automation depth impose separate bounds.
- A non-owner records `turn_not_owned` without typing or provider work.
- Agent-authored discussion remains bounded by automation depth, cooldown, rate limits, and exact effect-request authority. An unaddressed agent turn never bypasses these checks.
