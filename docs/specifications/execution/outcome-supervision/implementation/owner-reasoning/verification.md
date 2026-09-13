# Verification

A native-protocol fixture runs the actual Codex adapter with an isolated profile. It checks the read-only sandbox, observes fifty reported tokens without a worker assignment, reuses the stored decision, creates one canonical assignment and acquires its responsibility/lease without a second model call.

Changed source bytes reject reuse and permit a new bounded observation. Corrupt stored source text, missing evidence and invalid authority fail instead of falling back.

The fixture neither calls an external model nor establishes semantic correctness of its generated proposal.
