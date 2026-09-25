/**
 * Escalations count toward the eight-event capacity only after the latest reviewed installation of
 * this supervision's mandate. That installation is the human decision that answered them, just as
 * it opens a fresh owner spend epoch; without it the capacity stayed exhausted for the whole goal.
 */
export function escalationsSinceLatestInstallation(
  events: readonly { seq: number; type: string; payload: Record<string, unknown> }[],
  supervisionEvents: readonly { seq: number; type: string }[],
  supervisionId: string,
): number {
  let installedSeq = 0;
  for (const event of events)
    if (
      event.type === "work.supervision.mandate.installed" &&
      event.payload.supervisionId === supervisionId
    )
      installedSeq = Math.max(installedSeq, event.seq);
  return supervisionEvents.filter(
    (event) => event.type === "work.supervision.escalation.recorded" && event.seq > installedSeq,
  ).length;
}
