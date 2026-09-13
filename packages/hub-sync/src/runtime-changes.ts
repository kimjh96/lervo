/** Ephemeral hints only. Consumers must re-read durable state and revalidate authority. */
export interface HubRuntimeChangeScope {
  topic: "workstream" | "command";
  projectId: string;
  repositoryIdentityHash: string;
  destinationId: string;
}

export interface HubRuntimeChangeSource {
  waitForRuntimeChange(
    input: HubRuntimeChangeScope & {
      cursor: string | null;
      signal: AbortSignal;
    },
  ): Promise<{ cursor: string; status: "changed" | "timeout" }>;
}

export class HubRuntimeChangeError extends Error {
  constructor(readonly code: "registration_required" | "capacity_exceeded" | "source_closed") {
    super("The runtime change subscription is unavailable.");
    this.name = "HubRuntimeChangeError";
  }
}
