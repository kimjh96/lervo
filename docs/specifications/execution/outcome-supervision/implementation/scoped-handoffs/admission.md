# Admission and replay

Native proposals select a recipient from recorded peer observations or accept one observed incoming handoff hash. Before commit, the effect adapter revalidates the local task basis, both exact active owners and workstream snapshots, installed routes, offer expiry, event heads, and the local SQLite owner fence. A recipient also verifies the source offer event ID and event hash against the source's admitted policy decision. Foreign event references remain explicit fields; local causation contains only local events.

Offers and acceptances have deterministic, decision-bound local receipts. A receipt failure is reconciled by inspecting that exact receipt. Confirmed replay writes nothing and does not require peer availability. Missing receipts authorize no claim of acceptance. Pending offers retain their deadline and suppress repeated idle planning. A committed successor receipt wakes the original owner without replaying worker execution.
