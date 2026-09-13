import { isAbsolute } from "node:path";
import { listAgents } from "@lervo/agent-workforce";
import {
  openReadOnlyProjectStorage,
  resolveRepositoryCoordinationHome,
  type ProjectStorage,
} from "@lervo/project-storage";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import type { WorkHandoffPartyV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import {
  assertNodeSupervisionBinding,
  observeNodeSupervisionAuthority,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";

/** A host-installed observation route. It grants no source or recipient execution authority. */
export interface NodeSupervisionPeerConfiguration {
  repositoryRoot: string;
  repositoryInstanceId: string;
  projectId: string;
  teamId: string;
  binding: NodeSupervisionBinding;
}

export function assertNodeSupervisionPeerConfiguration(
  configuration: NodeSupervisionPeerConfiguration,
): void {
  if (configuration === null || typeof configuration !== "object")
    throw new Error("The installed peer observation route is invalid.");
  assertNodeSupervisionBinding(configuration.binding);
  if (
    Object.keys(configuration).length !== 5 ||
    typeof configuration.repositoryRoot !== "string" ||
    !isAbsolute(configuration.repositoryRoot) ||
    configuration.repositoryRoot.length > 4096 ||
    /[\0\r\n]/u.test(configuration.repositoryRoot) ||
    !/^rpi_[a-f0-9]{24}$/u.test(configuration.repositoryInstanceId) ||
    !/^prj_[a-f0-9]{16}$/u.test(configuration.projectId) ||
    !/^team_[A-Za-z0-9_-]{8,64}$/u.test(configuration.teamId)
  )
    throw new Error("The installed peer observation route is invalid.");
}

export class SupervisionPeerSource {
  private readonly history: SupervisionAuthorityHistory;
  private constructor(
    readonly storage: ProjectStorage,
    private readonly configuration: NodeSupervisionPeerConfiguration,
    private readonly now: () => string,
  ) {
    this.history = new SupervisionAuthorityHistory(
      storage.events,
      storage.paths.eventDatabase,
      storage.manifest.projectId,
      () => Date.parse(now()),
      "execution",
    );
  }

  static async open(configuration: NodeSupervisionPeerConfiguration, now: () => string) {
    configuration = structuredClone(configuration);
    assertNodeSupervisionPeerConfiguration(configuration);
    const storage = await openReadOnlyProjectStorage(configuration.repositoryRoot);
    try {
      const source = new SupervisionPeerSource(storage, configuration, now);
      await source.read();
      return source;
    } catch (error) {
      await storage.close();
      throw error;
    }
  }

  async read() {
    const startedAt = this.now();
    const { storage, configuration } = this;
    const home = await resolveRepositoryCoordinationHome(configuration.repositoryRoot, {
      readOnly: true,
    });
    if (
      home.repositoryInstanceId !== configuration.repositoryInstanceId ||
      storage.manifest.projectId !== configuration.projectId
    )
      throw new Error("The peer route no longer identifies its exact repository instance.");
    const head = storage.events.latest()?.eventHash ?? null;
    const agentsBefore = await listAgents(configuration.repositoryRoot, { readOnly: true });
    const authority = await observeNodeSupervisionAuthority(
      storage,
      configuration.binding,
      this.now,
      this.history,
    );
    const workstream = await readCurrentWorkstreamState(configuration.repositoryRoot);
    const agents = await listAgents(configuration.repositoryRoot, { readOnly: true });
    const owner = agents.find((agent) => agent.agentId === configuration.binding.ownerAgentId);
    const age = Date.parse(this.now()) - Date.parse(startedAt);
    if (
      workstream === null ||
      workstream.snapshot.workstreamId !== configuration.binding.workstreamId ||
      authority.source.teamId !== configuration.teamId ||
      authority.source.workstreamRevision !== workstream.snapshot.revision ||
      owner?.status !== "active" ||
      operatingContractHash(agentsBefore) !== operatingContractHash(agents) ||
      (storage.events.latest()?.eventHash ?? null) !== head ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 5000
    )
      throw new Error("The peer authority or workstream changed while it was observed.");
    const party: WorkHandoffPartyV1 = {
      projectId: configuration.projectId,
      teamId: configuration.teamId,
      workstreamId: workstream.snapshot.workstreamId,
      workstreamRevision: workstream.snapshot.revision,
      ownerAgentId: configuration.binding.ownerAgentId,
      mandateHash: configuration.binding.mandateHash,
    };
    return {
      party,
      repositoryInstanceId: home.repositoryInstanceId,
      workstreamSnapshotHash: workstream.contentHash,
      objective: workstream.snapshot.objective,
      workstreamStatus: workstream.snapshot.status,
      ownerRoleId: owner.roleId,
      eventHeadHash: head,
      observedAt: this.now(),
    };
  }

  close() {
    return this.storage.close();
  }
}
