# Persistence and failures

The composition adds no event schema or durable state format. It reuses installation, decision, receipt, and owner-lease contracts and their privacy rules.

- Binding errors reject mismatched identities.
- Unavailable or changed authority blocks admission.
- Closed-session errors reject escaped operations.
- Missing authority becomes unavailable snapshot evidence.
- An exception after a recorded decision retains uncertainty for inspection rather than replaying the effect.
