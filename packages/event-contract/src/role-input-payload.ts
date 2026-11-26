/** The most bytes a role's prepared input may hold, from its binding event to the bytes it names. */
export const MAX_ROLE_INPUT_BYTES = 128 * 1024;

export const roleInputPayloadFields = [
  "schemaVersion",
  "roleId",
  "roleContractHash",
  "inputContractId",
  "inputArtifactHash",
  "inputByteCount",
] as const;

export function validateRoleInputPayload(payload: Record<string, unknown>): void {
  if (
    Object.keys(payload).length !== roleInputPayloadFields.length ||
    !roleInputPayloadFields.every((key) => Object.hasOwn(payload, key)) ||
    payload.schemaVersion !== 1 ||
    typeof payload.roleId !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(payload.roleId) ||
    typeof payload.inputContractId !== "string" ||
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(payload.inputContractId) ||
    ![payload.roleContractHash, payload.inputArtifactHash].every(
      (hash) => typeof hash === "string" && /^sha256:[a-f0-9]{64}$/u.test(hash),
    ) ||
    !Number.isSafeInteger(payload.inputByteCount) ||
    Number(payload.inputByteCount) < 1 ||
    Number(payload.inputByteCount) > MAX_ROLE_INPUT_BYTES
  )
    throw new TypeError("The role input binding payload is invalid.");
}
