import type { InstalledOperatingMandate } from "@lervo/application-contract";
import type { WorkforceAssignment } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import { observeOperatingWorkScope, operatingContractHash } from "@lervo/work-controller";
import { readInstalledNodeMandate, type NodeSupervisionBinding } from "./supervision-authority.js";

/** Caches immutable scope content only; every effect still revalidates current mandate authority. */
export class SupervisionWorkScopeSource {
  private cached: { eventSetHash: string; installation: InstalledOperatingMandate } | undefined;

  constructor(
    private readonly storage: ProjectStorage,
    private readonly binding: NodeSupervisionBinding,
    private readonly now: () => string,
  ) {}

  async read(events: readonly EventEnvelope[], assignments: readonly WorkforceAssignment[]) {
    const eventSetHash = operatingContractHash(
      events
        .filter(
          (event) =>
            event.payload.supervisionId === this.binding.supervisionId &&
            ["work.supervision.mandate.installed", "work.supervision.mandate.revoked"].includes(
              event.type,
            ),
        )
        .map((event) => event.eventHash),
    );
    if (this.cached?.eventSetHash !== eventSetHash)
      this.cached = {
        eventSetHash,
        installation: await readInstalledNodeMandate(this.storage, this.binding, this.now),
      };
    const mandate = this.cached.installation.mandate;
    return mandate.schemaVersion !== 3
      ? null
      : observeOperatingWorkScope({
          scope: mandate.workScope,
          projectId: this.storage.manifest.projectId,
          workstreamId: this.binding.workstreamId,
          events,
          assignments,
        });
  }
}
