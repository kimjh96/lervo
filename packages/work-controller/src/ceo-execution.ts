import type {
  CeoCommandRequest,
  CeoPolicy,
  OrganizationExecutiveEffect,
  OrganizationExecutiveEffectPort,
  OrganizationExecutiveEffectReceipt,
  OrganizationExecutiveEffectReplayPort,
  OrganizationExecutiveExecutionResult,
  OrganizationOperatingReport,
} from "@lervo/application-contract";

import { decideCeoCommand } from "./ceo-policy.js";
import { digest } from "./hash.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const EFFECT_ID = /^ceoe_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const ADAPTER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/u;
const EXTERNAL_EFFECT_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;

export function calculateOrganizationExecutiveEffectHash(
  effect: OrganizationExecutiveEffect,
): string {
  return digest(effect);
}

export function calculateOrganizationExecutiveParametersHash(parameters: unknown): string {
  return digest(parameters);
}

function assertEffect(effect: OrganizationExecutiveEffect): void {
  if (
    typeof effect !== "object" ||
    effect === null ||
    effect.schemaVersion !== 1 ||
    !EFFECT_ID.test(effect.effectId) ||
    !/^org_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(effect.organizationId) ||
    (effect.teamId !== null && !/^team_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(effect.teamId)) ||
    !ADAPTER_ID.test(effect.adapterId) ||
    !HASH.test(effect.parametersHash) ||
    digest(effect.parameters) !== effect.parametersHash
  ) {
    throw new TypeError("The organization executive effect contract is invalid.");
  }
}

function assertReceipt(
  receipt: OrganizationExecutiveEffectReceipt,
  input: {
    effect: OrganizationExecutiveEffect;
    request: CeoCommandRequest;
    decisionHash: string;
    effectHash: string;
  },
): void {
  if (
    receipt.schemaVersion !== 1 ||
    receipt.effectId !== input.effect.effectId ||
    receipt.requestId !== input.request.requestId ||
    receipt.decisionHash !== input.decisionHash ||
    receipt.effectHash !== input.effectHash ||
    receipt.adapterId !== input.effect.adapterId ||
    !EXTERNAL_EFFECT_ID.test(receipt.externalEffectId) ||
    !HASH.test(receipt.resultHash) ||
    !Number.isSafeInteger(Date.parse(receipt.completedAt))
  ) {
    throw new TypeError("The organization executive effect receipt contract is invalid.");
  }
}

export async function executeOrganizationExecutiveCommand(input: {
  policy: CeoPolicy;
  request: CeoCommandRequest;
  organization: OrganizationOperatingReport;
  effect: OrganizationExecutiveEffect;
  adapter: OrganizationExecutiveEffectPort;
  replay: OrganizationExecutiveEffectReplayPort;
  now?: () => Date;
}): Promise<OrganizationExecutiveExecutionResult> {
  const decision = decideCeoCommand(input);
  if (decision.status !== "allowed") return { status: "not_allowed", decision };
  assertEffect(input.effect);
  const effectHash = calculateOrganizationExecutiveEffectHash(input.effect);
  if (
    input.request.effectHash !== effectHash ||
    input.effect.organizationId !== input.request.organizationId ||
    input.effect.teamId !== input.request.teamId ||
    input.effect.action !== input.request.action ||
    input.effect.adapterId !== input.adapter.adapterId ||
    !input.adapter.actions.includes(input.effect.action)
  ) {
    throw new TypeError(
      "The approved organization executive request does not bind the exact effect adapter and payload.",
    );
  }
  const attemptedAt = (input.now ?? (() => new Date()))().toISOString();
  const coordinate = {
    effectId: input.effect.effectId,
    requestId: input.request.requestId,
    effectHash,
  };
  const replay = await input.replay.begin({ ...coordinate, attemptedAt });
  if (replay.status === "completed") {
    assertReceipt(replay.receipt, {
      effect: input.effect,
      request: input.request,
      decisionHash: decision.decisionHash,
      effectHash,
    });
    return { status: "replayed", decision, receipt: replay.receipt };
  }
  if (replay.status === "unknown") return { status: "uncertain", decision, effectHash };
  if (replay.status === "rejected") return { status: "rejected", decision, effectHash };
  if (replay.status === "conflict") {
    throw new TypeError(
      "The organization executive effect replay coordinate conflicts with another payload.",
    );
  }
  let result: Awaited<ReturnType<OrganizationExecutiveEffectPort["apply"]>>;
  try {
    result = await input.adapter.apply(structuredClone(input.effect));
  } catch {
    await input.replay.markUnknown(coordinate);
    return { status: "uncertain", decision, effectHash };
  }
  if (result.status === "rejected") {
    if (!/^[a-z][a-z0-9_]{1,63}$/u.test(result.reasonCode)) {
      await input.replay.markUnknown(coordinate);
      return { status: "uncertain", decision, effectHash };
    }
    await input.replay.markRejected(coordinate);
    return { status: "rejected", decision, effectHash };
  }
  const receipt: OrganizationExecutiveEffectReceipt = {
    schemaVersion: 1,
    ...coordinate,
    decisionHash: decision.decisionHash,
    adapterId: input.effect.adapterId,
    externalEffectId: result.externalEffectId,
    resultHash: result.resultHash,
    completedAt: result.completedAt,
  };
  assertReceipt(receipt, {
    effect: input.effect,
    request: input.request,
    decisionHash: decision.decisionHash,
    effectHash,
  });
  await input.replay.complete(receipt);
  return { status: "completed", decision, receipt };
}
