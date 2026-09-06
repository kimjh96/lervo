import {
  parseRepositoryRoleSource,
  renderRepositoryRoleSource,
  type RepositoryRoleSource,
} from "@lervo/roles";

import {
  assertExactPassedWorkflowVerification,
  type PassedWorkflowVerificationEvidence,
  type WorkflowVerificationReference,
} from "./portable-skill-pattern.js";

export interface RoleProfileActivationEvidence {
  eventId: string;
  eventHash: string;
  runId: string;
  provider: "codex" | "claude";
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  roleProfileHash: string;
  runtimeProfileHash: string;
}

export interface AgentProfileEvidenceReference {
  independentGroup: string;
  activation: RoleProfileActivationEvidence;
  verification: WorkflowVerificationReference;
}

export interface AgentProfileTarget {
  kind: "agent_profile";
  path: string;
  content: string;
  expectedCurrentHash: string | null;
}

const HASH = /^sha256:[a-f0-9]{64}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const RUN_ID = /^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;

function assertActivationReference(value: RoleProfileActivationEvidence): void {
  if (
    !EVENT_ID.test(value.eventId) ||
    !HASH.test(value.eventHash) ||
    !RUN_ID.test(value.runId) ||
    !["codex", "claude"].includes(value.provider) ||
    !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(value.roleId) ||
    !VERSION.test(value.roleVersion) ||
    !HASH.test(value.roleContractHash) ||
    !HASH.test(value.roleProfileHash) ||
    !HASH.test(value.runtimeProfileHash)
  )
    throw new Error("Agent-profile activation evidence is unsafe or unbounded.");
}

function sameActivation(
  expected: RoleProfileActivationEvidence,
  observed: RoleProfileActivationEvidence,
): boolean {
  return (Object.keys(observed) as Array<keyof RoleProfileActivationEvidence>).every(
    (field) => observed[field] === expected[field],
  );
}

function parseTargetSource(target: AgentProfileTarget): RepositoryRoleSource {
  const match = /^\.lervo\/roles\/([a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)\.json$/u.exec(target.path);
  if (
    match === null ||
    (target.expectedCurrentHash !== null && !HASH.test(target.expectedCurrentHash))
  )
    throw new Error("An agent-profile target requires a safe role path and exact current hash.");
  let value: unknown;
  try {
    value = JSON.parse(target.content);
  } catch {
    throw new Error("The agent-profile target must contain valid repository-role JSON.");
  }
  const source = parseRepositoryRoleSource(value, match[1]);
  if (renderRepositoryRoleSource(source) !== target.content)
    throw new Error("The agent-profile target must use deterministic repository-role rendering.");
  return source;
}

export function assertAgentProfilePattern(input: {
  target: AgentProfileTarget;
  independentGroups: ReadonlySet<string>;
  evidence: AgentProfileEvidenceReference[] | undefined;
  passedVerificationEvidence: readonly PassedWorkflowVerificationEvidence[];
  activationEvidence: readonly RoleProfileActivationEvidence[];
}): RepositoryRoleSource {
  const source = parseTargetSource(input.target);
  const evidence = input.evidence;
  if (
    evidence === undefined ||
    evidence.length !== input.independentGroups.size ||
    evidence.length < 2 ||
    evidence.length > 64 ||
    new Set(evidence.map((item) => item.independentGroup)).size !== evidence.length ||
    [...input.independentGroups].some(
      (group) => !evidence.some((item) => item.independentGroup === group),
    ) ||
    evidence.some(
      (item) =>
        item.independentGroup !== item.verification.independentGroup ||
        item.activation.runId !== item.verification.runId,
    ) ||
    new Set(evidence.map((item) => item.activation.eventId)).size !== evidence.length ||
    new Set(evidence.map((item) => item.verification.eventId)).size !== evidence.length ||
    new Set(evidence.map((item) => item.activation.runId)).size !== evidence.length
  )
    throw new Error(
      "An agent-profile candidate requires one distinct activated and passed run per independent evidence group.",
    );

  const activations = new Map(input.activationEvidence.map((item) => [item.eventId, item]));
  for (const item of evidence) {
    assertActivationReference(item.activation);
    const observed = activations.get(item.activation.eventId);
    if (observed === undefined || !sameActivation(item.activation, observed))
      throw new Error("Agent-profile activation evidence is missing or changed.");
  }
  assertExactPassedWorkflowVerification(
    evidence.map((item) => item.verification),
    input.passedVerificationEvidence,
  );

  const [first, ...rest] = evidence.map((item) => item.activation);
  if (
    first === undefined ||
    rest.some(
      (item) =>
        item.roleId !== first.roleId ||
        item.roleVersion !== first.roleVersion ||
        item.roleContractHash !== first.roleContractHash ||
        item.roleProfileHash !== first.roleProfileHash,
    )
  )
    throw new Error("Agent-profile evidence must bind one exact source role contract.");

  if (source.roleId === first.roleId) {
    if (input.target.expectedCurrentHash === null || source.version === first.roleVersion)
      throw new Error("A replacement profile requires the exact current target and a new version.");
  } else if (
    !source.extends.some(
      (reference) => reference.roleId === first.roleId && reference.version === first.roleVersion,
    )
  ) {
    throw new Error("A new agent profile must specialize its exact evidence-bound source role.");
  }
  return source;
}
