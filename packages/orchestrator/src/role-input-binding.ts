import { createHash } from "node:crypto";
import type { ContextArtifactPort } from "@lervo/context-delivery";
import { MAX_ROLE_INPUT_BYTES } from "@lervo/event-contract";
import type { ManagedProviderRunInput } from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";

/** Records exact prepared input bytes before provider creation, without asserting delivery or use. */
export async function prepareRoleInputBinding(input: {
  binding: NonNullable<ManagedProviderRunInput["roleInput"]>;
  roleId: string;
  artifacts: ContextArtifactPort;
  now: string;
}): Promise<ManagedEventSpec> {
  const binding = input.binding;
  if (
    binding === null ||
    typeof binding !== "object" ||
    Object.keys(binding).length !== 3 ||
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(binding.contractId) ||
    ![binding.roleContractHash, binding.inputArtifactHash].every((hash) =>
      /^sha256:[a-f0-9]{64}$/u.test(hash),
    )
  )
    throw new Error("The prepared role input coordinate is invalid.");
  const bytes = await input.artifacts.get(
    `lervo-cas://sha256/${binding.inputArtifactHash.slice(7)}`,
  );
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > MAX_ROLE_INPUT_BYTES ||
    `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== binding.inputArtifactHash
  )
    throw new Error("The prepared role input differs from its exact bounded CAS bytes.");
  JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  return {
    schemaVersion: 3,
    type: "role.input.bound",
    actor: { kind: "system" },
    occurredAt: input.now,
    payload: {
      schemaVersion: 1,
      roleId: input.roleId,
      roleContractHash: binding.roleContractHash,
      inputContractId: binding.contractId,
      inputArtifactHash: binding.inputArtifactHash,
      inputByteCount: bytes.byteLength,
    },
  };
}
