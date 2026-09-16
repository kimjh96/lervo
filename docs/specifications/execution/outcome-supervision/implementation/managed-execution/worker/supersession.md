# Managed run supersession

- [Empty-run supersession](supersession/empty-run.md): version-four absence evidence, fencing, replay, and recovery.
- [Reservation-only supersession](supersession/reservation-only.md): version-five evidence for an exact sole reservation.
- [Prepared workspace without dispatch](supersession/prepared-workspace.md): read-only retention proof and later admission checks.

Version four requires an empty run. Version five admits only the reservation-only case. Other partial runs remain uncertain unless separate [pre-turn host-reset recovery](../assignment-recovery.md) records an exact fenced failed terminal.

Supersession grants no execution or task lease. It preserves the assignment, responsibility, checkout, old lease, and resource history. Before another attempt, the owner must obtain a current responsibility and lease through a separately admitted recovery decision.
