import { validateSchema } from "@lervo/schemas";
import { isAbsolute } from "node:path";
import {
  assertNodeSupervisionBinding,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";
import { configRecord, exactConfigKeys, configText } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";
import {
  snapshotRuntimeReadinessConfiguration,
  type NodeRuntimeReadinessConfiguration,
} from "./supervision-runtime-configuration.js";
import type { NodeOwnerReasoningConfiguration } from "./supervision-reasoning-effects.js";
import type { NodeSupervisedManagedConfiguration } from "./supervision-managed-effects.js";
import type { NodeSupervisionResultDeliveryConfiguration } from "./supervision-result-delivery.js";
import {
  assertNodeSupervisionPeerConfiguration,
  type NodeSupervisionPeerConfiguration,
} from "./supervision-peer-source.js";

/** Trusted host launch material selects an installed mandate; it cannot install or widen authority. */
export interface NodeSupervisionStartupConfiguration {
  /** The pinned owner binding, or the lineage root when `standing` is true. */
  binding: NodeSupervisionBinding;
  /**
   * Standing supervision: the binding names the lineage root and the runtime follows the latest
   * successor goal the owner installed under the root mandate's reviewed successor grant.
   */
  standing?: boolean;
  runtimeReadiness: NodeRuntimeReadinessConfiguration;
  ownerReasoning: NodeOwnerReasoningConfiguration;
  managedExecution: NodeSupervisedManagedConfiguration;
  resultOrigin?: NodeSupervisionResultDeliveryConfiguration["origin"];
  handoffPeers?: NodeSupervisionPeerConfiguration[];
}

export function parseSupervisionStartupConfiguration(
  value: unknown,
): NodeSupervisionStartupConfiguration {
  const source = configRecord(value, "outcomeSupervision");
  exactConfigKeys(
    source,
    [
      "binding",
      "standing",
      "runtimeReadiness",
      "ownerReasoning",
      "managedExecution",
      "resultOrigin",
      "handoffPeers",
    ],
    "outcomeSupervision",
  );
  // An already parsed configuration carries the lineage root under `binding` with `standing: true`.
  const parsed = source.standing === true && source.binding !== undefined;
  if (!parsed && (source.binding === undefined) === (source.standing === undefined))
    throw new NodeRuntimeError(
      "invalid_config",
      "Supervision requires exactly one of outcomeSupervision.binding or outcomeSupervision.standing.",
    );
  const standing = parsed || source.standing !== undefined;
  const bindingKey = standing && !parsed ? "standing" : "binding";
  const binding = configRecord(source[bindingKey], `outcomeSupervision.${bindingKey}`);
  exactConfigKeys(
    binding,
    ["supervisionId", "workstreamId", "ownerAgentId", "mandateHash"],
    `outcomeSupervision.${bindingKey}`,
  );
  assertNodeSupervisionBinding(binding as unknown as NodeSupervisionBinding);
  const owner = configRecord(source.ownerReasoning, "outcomeSupervision.ownerReasoning");
  exactConfigKeys(
    owner,
    ["provider", "model", "reservedTokens"],
    "outcomeSupervision.ownerReasoning",
  );
  if (
    !["codex", "claude"].includes(String(owner.provider)) ||
    !Number.isSafeInteger(owner.reservedTokens) ||
    Number(owner.reservedTokens) < 1 ||
    Number(owner.reservedTokens) > 1_000_000 ||
    (owner.model !== undefined &&
      (typeof owner.model !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(owner.model)))
  )
    throw new NodeRuntimeError(
      "invalid_config",
      "The supervision owner provider budget or model is invalid.",
    );
  const managed = configRecord(source.managedExecution, "outcomeSupervision.managedExecution");
  exactConfigKeys(managed, ["nodeExecutable", "cliBundle"], "outcomeSupervision.managedExecution");
  for (const key of ["nodeExecutable", "cliBundle"])
    if (!isAbsolute(configText(managed[key], `outcomeSupervision.managedExecution.${key}`)))
      throw new NodeRuntimeError("invalid_config", "Supervised process paths must be absolute.");
  const readiness = configRecord(source.runtimeReadiness, "outcomeSupervision.runtimeReadiness");
  exactConfigKeys(
    readiness,
    [
      "workerWorkspace",
      "providerLoginContexts",
      "verificationSuiteHashes",
      "providerExecutables",
      "verificationTools",
    ],
    "outcomeSupervision.runtimeReadiness",
  );
  const configuration = snapshotRuntimeReadinessConfiguration(
    readiness as unknown as NodeRuntimeReadinessConfiguration,
  )!;
  const provider = owner.provider as "codex" | "claude";
  if (
    configuration.providerExecutables[provider] === undefined ||
    configuration.providerLoginContexts?.[provider] === undefined ||
    configuration.workerWorkspace === undefined
  )
    throw new NodeRuntimeError(
      "invalid_config",
      "Native supervision requires explicit provider login and workspace coordinates.",
    );
  let resultOrigin: NodeSupervisionResultDeliveryConfiguration["origin"] | undefined;
  let handoffPeers: NodeSupervisionPeerConfiguration[] | undefined;
  if (source.handoffPeers !== undefined) {
    if (!Array.isArray(source.handoffPeers) || source.handoffPeers.length > 8)
      throw new NodeRuntimeError(
        "invalid_config",
        "Handoff observation requires at most eight installed peer routes.",
      );
    handoffPeers = structuredClone(source.handoffPeers) as NodeSupervisionPeerConfiguration[];
    for (const peer of handoffPeers) assertNodeSupervisionPeerConfiguration(peer);
    if (new Set(handoffPeers.map((peer) => peer.projectId)).size !== handoffPeers.length)
      throw new NodeRuntimeError(
        "invalid_config",
        "Handoff routes must identify distinct peer projects.",
      );
  }
  if (source.resultOrigin !== undefined) {
    if (!validateSchema("conversationOutboundOrigin", source.resultOrigin).valid)
      throw new NodeRuntimeError("invalid_config", "The supervision result origin is invalid.");
    resultOrigin = structuredClone(
      source.resultOrigin,
    ) as NodeSupervisionResultDeliveryConfiguration["origin"];
  }
  return {
    binding: structuredClone(binding) as unknown as NodeSupervisionBinding,
    ...(standing ? { standing: true } : {}),
    runtimeReadiness: configuration,
    ownerReasoning: structuredClone(owner) as unknown as NodeOwnerReasoningConfiguration,
    managedExecution: structuredClone(managed) as unknown as NodeSupervisedManagedConfiguration,
    ...(resultOrigin === undefined ? {} : { resultOrigin }),
    ...(handoffPeers === undefined ? {} : { handoffPeers }),
  };
}
