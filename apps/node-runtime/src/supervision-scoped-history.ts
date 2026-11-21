import type { EventStore } from "@lervo/storage-contract";
import { operatingContractHash } from "@lervo/work-controller";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import {
  isSupervisionHistoryMetadata,
  selectSupervisionHistoryRuns,
} from "./supervision-history-selection.js";

/** Both readers audit the full chain; changing scope backfills exact earlier native rows. */
export class ScopedSupervisionExecutionHistory extends SupervisionAuthorityHistory {
  private selected: SupervisionAuthorityHistory | undefined;
  private selectionHash: string | undefined;

  constructor(
    private readonly input: {
      events: EventStore;
      databasePath: string;
      projectId: string;
      workstreamId: string;
    },
  ) {
    super(input.events, input.databasePath, input.projectId, isSupervisionHistoryMetadata);
  }

  override async read() {
    for (let pass = 0; pass < 16; pass += 1) {
      const metadata = await super.read();
      const runs = selectSupervisionHistoryRuns(metadata, this.input.workstreamId);
      const selectionHash = operatingContractHash([...runs].sort());
      if (this.selectionHash !== selectionHash || this.selected === undefined) {
        this.selected = new SupervisionAuthorityHistory(
          this.input.events,
          this.input.databasePath,
          this.input.projectId,
          (event) => isSupervisionHistoryMetadata(event) || runs.has(event.runId),
        );
        this.selectionHash = selectionHash;
      }
      const selected = await this.selected.read();
      const currentRuns = selectSupervisionHistoryRuns(selected, this.input.workstreamId);
      if (operatingContractHash([...currentRuns].sort()) === selectionHash) return selected;
    }
    throw Object.assign(new Error("The supervision history scope did not stabilize."), {
      code: "supervision_history_scope_unstable",
    });
  }
}
