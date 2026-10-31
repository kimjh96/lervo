# Admission

Shared host admission permits two background calls across providers and one per repository, with oldest eligible waiter fairness. Active ordinary work defers admission without preempting an existing call.

After an admission owner process exits, the next admission transaction immediately removes its slot, even before timeout. A live owner's active slot remains reserved until release or its existing recovery contract applies. A dead process cannot block the same repository's next bounded attempt for the full timeout.

Foreground admission defers capability-free provider work during an ordinary assignment's current unexpired lease. Missing or invalid expiry remains fail-closed; expired lease metadata alone cannot defer read-only generation forever.

This scheduling predicate neither proves a native process stopped nor settles, cancels, reopens, or removes the expired assignment. Existing effect and lease contracts still govern uncertain effects, scoped write conflicts, exact source checks, and integration recovery.

The worker and explicit provider probe share this predicate; caller-supplied current-work observations may remain stricter.

## Installed provider CLI admission

[ADR-0536](../../../../../decisions/execution/providers/admission/0536-admit-provider-clis-by-contract.md) applies to background convergence, document normalization, freshness, owner-turn capture, and per-change knowledge review. Interactive managed runs and hooks keep their existing provider resolution. Conversation-origin background normalization, including event schemas before 4, uses this admission boundary.

Before a capability-free call, the host resolves the owner's installed CLI. The login shell runs a fixed script with a three-second deadline. The script removes aliases and provider functions, then resolves provider names passed as positional arguments. Only absolute paths to regular executable files qualify. The lookup captures at most 8 KiB of login `PATH` in private state. Missing or empty `HOME` and `SHELL` use the system account home and shell, then the system fallback. A failed or timed-out shell produces a detection finding and uses well-known locations with a deterministic fallback PATH.

Locations include the npm prefix read from `~/.npmrc`, common npm global bins, Homebrew prefixes, `~/.local/bin`, the Claude native location, the nvm default, and Volta/asdf/mise shims. Detection does not invoke npm or install or copy a provider CLI. The invocation path preserves a shim's file name. Its directory precedes the captured login PATH for version, probe, and execution. The resolved real path identifies file bytes; it does not replace the invocation path.

Dispatch policy `filesystem-root-allowlist-v1` runs version and identity checks, contract probes, and model calls at the filesystem root. These paths use one environment constructor that filters inherited and supplied variables through the provider allow-list. The captured login PATH and resolved account HOME and SHELL override inherited values. Checkout and scratch-directory names cannot alter shim dispatch. Response schemas remain in private temporary files passed by absolute path. The policy identifier is part of the identity hash, so caches created under the previous dispatch context require fresh admission.

An optional `~/.lervo/provider-clis.json` names owner overrides:

```json
{
  "schemaVersion": 1,
  "executables": { "claude": "/absolute/path/to/claude" }
}
```

Overrides still need admission. No background resident consumes `outcomeSupervision.runtimeReadiness.providerExecutables` as an override. That Node configuration continues to govern its managed and interactive consumers.

The private host cache is `~/.lervo/state/provider-clis/current.json`, mode 0600 in a 0700 directory, with at most 32 current candidate identities and a 512 KiB read bound. Cache schema 3 retains private invocation paths, real paths, stat fingerprints, version-output hashes, and the bounded invocation environment. Detection identities are stored separately from probe results. Probe entries reference the detection identity hash without duplicating the private environment. Unprobed candidates retain their detection identity without an admission claim. Both collections are bounded to 32 current candidates and pruned on replacement. Older cache schemas require fresh admission. Candidate-location discovery refreshes after 60 seconds when work runs; the resident's existing reconciliation ceiling bounds idle rediscovery.

Before each provider call, the adapter checks the real path and its device, inode, size, and modification time. Unchanged native executables outside version-manager paths reuse the version and content hash, including candidates skipped by probe ordering or delegation. Scripts, known shim directories, and symlink chains through version managers bind their identity to a hash of the bounded `--version` output. Resolution reruns `--version` when evaluating these candidates for use, and every provider call repeats that check. Unprobed candidates reuse their stat-bound detection observation without another version command until evaluation. Changed output triggers readmission even when the shim fingerprint is unchanged. Failed or timed-out version commands fail the identity check. Changed file fingerprints trigger hashing and readmission. A changed identity stops the batch even when readmission succeeds. A later turn rebuilds the compiler and its identity-bound descriptor. Completed shards retain their original descriptors; no new call is attributed to one. These checks also apply to freshness, instruction capture, per-change review, and legacy conversation normalization.

Codex uses the existing model-input probe with every disabled feature and accepts only message items. Claude runs a bounded 30-second probe with empty tools, strict empty MCP configuration, empty settings sources, and the existing no-capability flags. Its separate admission validator rejects `structured_output`, requires exactly one turn, `end_turn`, an empty permission-denial list, explicit zero server-tool counters, and the exact reply `{"ok":true}`. The general native structured-output parser cannot validate admission.

The host probes in preferred-provider and delegation order and stops at the first admitted candidate. A per-identity in-flight guard and a SQLite host cache lease protect read–probe–write. A live holder prevents another writer from replacing its result; a dead holder can be reclaimed. Cached-only observers do not write cache files, admission events, or project projections. Removed identities are pruned when the current cache is replaced.

Transient probe failures wait 60 seconds and double that delay for each failure, capped at one hour. Capability failures remain rejected until identity changes. Paid Claude probes reserve a call from a delegation-hash-bound admission-probe budget, capped by the delegated call ceiling. Every paid attempt records observed native usage or unavailable usage. Missing usage rejects admission and enters transient backoff. Legacy background normalization has its own delegation-hash-bound call budget. Probe processes and output are bounded, share ordinary host admission, and defer during current foreground work. Quota and authentication failures create the existing provider pause. Automatic contract probes never use the explicit availability-probe bypass. A NULL-reset pause enters the bounded automatic recovery path in [Provider pauses and probes](../../events-and-status/provider-pauses-and-probes.md) when its next allowed candidate is due. Native success with observed usage uses compare-and-settle recovery. Other paused providers, including cached admissions, are skipped while resolution continues with allowed candidates. A quota or authentication probe failure records its provider pause before continuing. A pause does not become a cached CLI contract rejection or consume another provider's opportunity to qualify. Budget, authority, and host-capacity failures retain their existing failure contracts.

The preferred provider runs when admitted. Otherwise the host selects another admitted provider from the reviewed delegation. A provider outside that list cannot run. Stage staffing, review identities, capture provenance, and usage attribution name the actual selected provider; review-result caches bind its executable identity. With none admitted, convergence records `waiting_authority` with `provider_not_admitted`; freshness and capture defer with that same reason. Rechecking the waiting dependency readmits the same stage when an allowed executable passes. NULL-reset quota/authentication pauses use the same automatic recovery path during readmission.
