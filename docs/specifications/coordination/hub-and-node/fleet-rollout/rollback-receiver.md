# Installed rollback receiver

The receiver accepts a distinct signed rollback envelope through owner-only request and trust files. It revalidates the exact predecessor plan, reserves a rollback-specific SQLite replay coordinate before mutation, returns completed duplicates, and leaves uncertain effects fenced.

Recovery inspects exact predecessor disposition and persists `rolled_back`, `not_rolled_back`, or `unknown` without invoking rollback.

The receiver adds signed delivery and replay controls to the [predecessor rollback adapter](predecessor-rollback.md) but grants no unattended delivery. It is a one-Node local process boundary, not a Hub endpoint, daemon transport, automatic selector, or multi-Node transaction.
