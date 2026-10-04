# Unattended scheduling

After assignments are queued and compatible agents are hired, `lervo loop schedule --provider codex --write` can poll, exact-revision claim, and managed-execute them within finite cycle, claim, run, time, retry, budget, lease, and kill-switch bounds.

It works locally without a Hub and does not grant approval, cancellation, topology-change, or in-flight preemption authority.

See [unattended scheduling](../../../../docs/specifications/execution/unattended-scheduling.md).
