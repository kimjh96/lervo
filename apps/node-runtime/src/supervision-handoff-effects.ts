import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { operatingContractHash, operatingDecisionId } from "@lervo/work-controller";
import {
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import type { NodeSupervisionEffectSession } from "./supervision-runtime-ports.js";
import type { NodeSupervisionPeerConfiguration } from "./supervision-peer-source.js";
import { observeSupervisionHandoffPeer } from "./supervision-handoff-peer.js";
import { readCanonicalSupervisionHandoff } from "./supervision-handoff-source.js";
import {
  inspectSupervisionHandoffReceipt,
  recordSupervisionHandoffReceipt,
} from "./supervision-handoff-receipt.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";

/** Owns local offer/acceptance effects. Peer handles cannot mutate repositories or transfer leases. */
export class SupervisionHandoffEffects {
  private readonly binding: NodeSupervisionBinding;
  private readonly peers: NodeSupervisionPeerConfiguration[];
  constructor(
    private readonly root: string,
    binding: NodeSupervisionBinding,
    peers: readonly NodeSupervisionPeerConfiguration[],
    private readonly now: () => string,
  ) {
    if (peers.length > 8 || new Set(peers.map((peer) => peer.projectId)).size !== peers.length)
      throw new Error("Handoff routes require at most eight distinct peer projects.");
    this.binding = structuredClone(binding);
    this.peers = structuredClone([...peers]);
  }
  async assertReady(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      const source = await new SupervisionTaskSource(storage, this.binding, this.now).read(
        operatingDecisionId(plan),
      );
      const basis = await readCanonicalSupervisionHandoff({
        source,
        binding: this.binding,
        artifacts: storage.artifacts,
        plan,
      });
      const observed = await observeSupervisionHandoffPeer({
        peers: this.peers,
        basis,
        now: this.now,
      });
      await observed.peer.close();
    } finally {
      await storage.close();
    }
  }
  async inspect(plan: OperatingActionPlanV1) {
    const storage = await openProjectStorage(this.root);
    try {
      return await inspectSupervisionHandoffReceipt(storage, plan);
    } finally {
      await storage.close();
    }
  }
  async execute(
    plan: OperatingActionPlanV1,
    session: Pick<NodeSupervisionEffectSession, "commit">,
  ) {
    const storage = await openProjectStorage(this.root);
    let peer: Awaited<ReturnType<typeof observeSupervisionHandoffPeer>> | undefined;
    try {
      return await recordSupervisionHandoffReceipt({
        storage,
        plan,
        now: this.now,
        commit: session.commit,
        validateCurrent: async () => {
          const tasks = new SupervisionTaskSource(storage, this.binding, this.now);
          const source = await tasks.read(operatingDecisionId(plan));
          const basis = await readCanonicalSupervisionHandoff({
            source,
            binding: this.binding,
            artifacts: storage.artifacts,
            plan,
          });
          peer = await observeSupervisionHandoffPeer({ peers: this.peers, basis, now: this.now });
          const authority = await observeNodeSupervisionAuthority(storage, this.binding, this.now);
          const observedAt = this.now();
          if (
            !authority.source.eligible ||
            authority.installation.revoked ||
            authority.source.teamId !== plan.teamId ||
            operatingContractHash({
              authorityDigest: authority.source.sourceRevisionDigest,
              taskDigest: source.sourceRevisionDigest,
            }) !== plan.sourceRevisionDigest ||
            (await tasks.read(operatingDecisionId(plan))).sourceRevisionDigest !==
              source.sourceRevisionDigest
          )
            throw new Error("The local handoff authority changed before commit.");
          return () => {
            const now = Date.parse(this.now());
            if (
              now - Date.parse(observedAt) < 0 ||
              now - Date.parse(observedAt) > 5000 ||
              now >=
                Math.min(
                  Date.parse(plan.deadline),
                  Date.parse(basis.offer.expiresAt),
                  Date.parse(authority.installation.mandate.expiresAt),
                ) ||
              storage.events.latest()?.eventHash !== source.events.at(-1)?.eventHash
            )
              throw new Error("The handoff observation or deadline changed before commit.");
            peer!.validateHead();
          };
        },
      });
    } finally {
      await peer?.peer.close();
      await storage.close();
    }
  }
}
