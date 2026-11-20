import { ResidentDeadlineTimer } from "./resident-deadline-timer.js";

/**
 * ADR-0602: what the resident's one timer waits for. Continuity (ADR-0470) is offered a turn at
 * its own next reconciliation as well as before each cycle, so a cycle waiting for host-wide
 * admission cannot starve it; the owner renews its lease (ADR-0466) at the heartbeat bound; the
 * health projection refreshes at its age bound; the reconcile deadline is the next due time or a
 * failure retry. A wall-clock step or a sleep only ever makes a deadline late, never early: the
 * timer fires on the monotonic clock and then hands over only names whose wall-clock moment has
 * passed, re-arming for the rest.
 */
export type ResidentDeadline = "reconcile" | "projection" | "owner" | "continuity";

export function residentDeadlines(
  handlers: Record<ResidentDeadline, () => void>,
  onRefused: (name: ResidentDeadline) => void,
): ResidentDeadlineTimer<ResidentDeadline> {
  const order: ResidentDeadline[] = ["reconcile", "continuity", "owner", "projection"];
  return new ResidentDeadlineTimer<ResidentDeadline>(
    (due) => {
      for (const name of order) if (due.includes(name)) handlers[name]();
    },
    Date.now,
    onRefused,
  );
}
