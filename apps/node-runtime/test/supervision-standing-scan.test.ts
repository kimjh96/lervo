import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import type { ListEventsOptions } from "@lervo/storage-contract";
import { expect, it } from "vitest";

import { scanForStandingLineageChange } from "../src/supervision-standing.js";

const projectId = `prj_${"f".repeat(16)}`;
const root = {
  supervisionId: "supervision.root",
  workstreamId: `wks_${"a".repeat(24)}`,
  ownerAgentId: `agt_${"b".repeat(24)}`,
  mandateHash: `sha256:${"c".repeat(64)}`,
};

function row(seq: number, type: string, supervisionId = "supervision.root"): EventEnvelope {
  return {
    seq,
    eventId: `evt_${String(seq).padStart(32, "0")}`,
    eventHash: `sha256:${String(seq).padStart(64, "0")}`,
    projectId,
    type,
    payload: { supervisionId, ownerAgentId: root.ownerAgentId },
  } as unknown as EventEnvelope;
}

function storage(rows: EventEnvelope[], honorTypes: boolean): ProjectStorage {
  return {
    manifest: { projectId },
    events: {
      latest: () => rows.at(-1) ?? null,
      list: ({ afterSeq = 0, limit = 100, types }: ListEventsOptions = {}) =>
        rows
          .filter((item) => item.seq > afterSeq)
          .filter((item) => !honorTypes || types === undefined || types.includes(item.type))
          .slice(0, limit),
    },
  } as unknown as ProjectStorage;
}

it("advances the lineage cursor to the observed head and finds installations only once", () => {
  for (const honorTypes of [true, false]) {
    const rows = Array.from({ length: 2_400 }, (_, index) => row(index + 1, "run.requested"));
    rows[1_500] = row(1_501, "work.supervision.mandate.installed", "supervision.root.1");
    const events = storage(rows, honorTypes);
    const watched = ["supervision.root.1", "supervision.root"];

    const first = scanForStandingLineageChange(events, root, watched, 0);
    expect(first).toEqual({ found: true, seq: 2_400 });
    expect(scanForStandingLineageChange(events, root, watched, first.seq)).toEqual({
      found: false,
      seq: 2_400,
    });

    rows.push(row(2_401, "run.requested"));
    rows.push(row(2_402, "work.supervision.mandate.installed", "supervision.unrelated"));
    expect(scanForStandingLineageChange(events, root, watched, 2_400)).toEqual({
      found: false,
      seq: 2_402,
    });
    rows.push(row(2_403, "work.supervision.mandate.installed", "supervision.root"));
    expect(scanForStandingLineageChange(events, root, watched, 2_402)).toEqual({
      found: true,
      seq: 2_403,
    });
  }
});
