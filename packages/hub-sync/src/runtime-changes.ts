/** Ephemeral hints only. Consumers must re-read durable state and revalidate authority. */
export interface HubRuntimeChangeScope {
  /**
   * `knowledge` (ADR-0602) covers the cross-host knowledge coordination state of one destination
   * and repository: the convergence owner lease, owner-rule candidates, host continuity records
   * and delegation-bound definitions.
   */
  topic: "workstream" | "command" | "knowledge";
  projectId: string;
  repositoryIdentityHash: string;
  destinationId: string;
}

export interface HubRuntimeChangeSource {
  waitForRuntimeChange(
    input: HubRuntimeChangeScope & {
      cursor: string | null;
      signal: AbortSignal;
      /**
       * ADR-0602: `open` holds until a change or the caller leaves, with no Hub-side timeout;
       * transport keepalive owns liveness. Absent keeps the bounded hold older clients expect.
       */
      hold?: "open";
      /** ADR-0602: the waiting host on the `knowledge` topic, so host listings carry presence. */
      hostHash?: string;
    },
  ): Promise<{ cursor: string; status: "changed" | "timeout" }>;
}

export class HubRuntimeChangeError extends Error {
  constructor(readonly code: "registration_required" | "capacity_exceeded" | "source_closed") {
    super("The runtime change subscription is unavailable.");
    this.name = "HubRuntimeChangeError";
  }
}
