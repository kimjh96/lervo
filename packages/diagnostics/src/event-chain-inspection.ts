import type { EventStore } from "@lervo/storage-contract";

import type { DoctorInspection } from "./types.js";

/** Verifies the local event hash chain without reading or rewriting any stored event. */
export function inspectDoctorEventChain(events: EventStore): DoctorInspection {
  try {
    const { eventCount } = events.verifyIntegrity();
    return {
      check: { checkId: "event_chain", status: "healthy", observedCount: eventCount },
      issues: [],
    };
  } catch {
    return {
      check: { checkId: "event_chain", status: "unhealthy", observedCount: 0 },
      issues: [
        {
          code: "event_chain_invalid",
          eventId: null,
          message: "The local event hash chain is invalid.",
        },
      ],
    };
  }
}
