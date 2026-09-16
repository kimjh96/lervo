# Admission and replay

Native proposals select a recipient from recorded peer observations or accept one observed incoming handoff hash. Before commit, the effect adapter revalidates:

- The local task basis.
- Both exact active owners and workstream snapshots.
- Installed routes, offer expiry, and event heads.
- The local SQLite owner fence.

The recipient also verifies the source offer event ID and event hash against the source's admitted policy decision. Foreign event references remain explicit fields; local causation contains only local events.

Offers and acceptances have deterministic, decision-bound local receipts. Reconcile a receipt failure by inspecting that exact receipt. Confirmed replay writes nothing and requires no peer availability. Missing receipts authorize no claim of acceptance.

Pending offers retain their deadline and suppress repeated idle planning. A committed successor receipt wakes the original owner without replaying worker execution.
