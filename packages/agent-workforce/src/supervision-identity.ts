import type { EventStore } from "@lervo/storage-contract";

/** A new journal identity cannot reset a workstream's mandate or execution-host ancestry. */
export function assertCanonicalSupervisionIdentity(input: {
  events: Readonly<ReturnType<EventStore["list"]>>;
  projectId: string;
  workstreamId: string;
  supervisionId?: string;
}): void {
  const identities = new Set(
    input.events
      .filter(
        (event) =>
          event.type === "work.supervision.mandate.installed" &&
          event.projectId === input.projectId &&
          event.payload.workstreamId === input.workstreamId,
      )
      .map((event) => event.payload.supervisionId),
  );
  if (
    identities.size > 1 ||
    (input.supervisionId !== undefined &&
      identities.size > 0 &&
      !identities.has(input.supervisionId))
  )
    throw new Error("The workstream already belongs to another supervision identity.");
}
