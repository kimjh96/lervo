import type { InstalledOperatingMandate } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";

import {
  NodeSupervisionError,
  readInstalledNodeMandate,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";

/** Resolve only reviewed revisions descending from the root pinned by Node configuration. */
export async function resolveStandingRoot(
  storage: ProjectStorage,
  pinned: NodeSupervisionBinding,
  now: () => string,
): Promise<{ binding: NodeSupervisionBinding; installation: InstalledOperatingMandate }> {
  let firstHash: string | null = null;
  let latestHash: string | null = null;
  let afterSeq = 0;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000 });
    if (events.length === 0) break;
    for (const event of events) {
      afterSeq = event.seq;
      if (
        event.type !== "work.supervision.mandate.installed" ||
        event.projectId !== storage.manifest.projectId ||
        event.payload.supervisionId !== pinned.supervisionId ||
        event.payload.workstreamId !== pinned.workstreamId ||
        event.payload.ownerAgentId !== pinned.ownerAgentId
      )
        continue;
      const hash = String(event.payload.mandateHash);
      firstHash ??= hash;
      latestHash = hash;
    }
    if (events.length < 1000) break;
  }
  if (firstHash !== pinned.mandateHash || latestHash === null)
    throw new NodeSupervisionError("supervision_binding_invalid");
  const binding = { ...pinned, mandateHash: latestHash };
  // The journal verifies every installation and predecessor, not just the newest event.
  const installation = await readInstalledNodeMandate(storage, binding, now);
  return { binding, installation };
}
