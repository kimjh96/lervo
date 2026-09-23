/** Resolves the exact current standing successor and its next possible owner lock. */
export async function resolveCurrentStandingUpgradeBinding(root, binding) {
  const { openReadOnlyProjectStorage } =
    await import("../../../packages/project-storage/dist/index.js");
  const { successorId } = await import("../../../packages/work-controller/dist/index.js");
  const { resolveStandingSupervisionBinding } =
    await import("../../../apps/node-runtime/dist/index.js");
  const storage = await openReadOnlyProjectStorage(root);
  try {
    const current = await resolveStandingSupervisionBinding(storage, binding, () =>
      new Date().toISOString(),
    );
    return {
      binding: current.binding,
      index: current.index,
      nextSupervisionId:
        current.index < 1024 ? successorId(binding.supervisionId, current.index + 1) : null,
    };
  } finally {
    await storage.close();
  }
}

export function validStandingUpgradeBinding(root, current) {
  return (
    current !== null &&
    typeof current === "object" &&
    Number.isSafeInteger(current.index) &&
    current.index >= 0 &&
    current.index <= 1024 &&
    current.binding?.ownerAgentId === root.ownerAgentId &&
    /^[a-z][a-z0-9_.:-]{0,127}$/u.test(current.binding?.supervisionId) &&
    (current.index === 1024
      ? current.nextSupervisionId === null
      : /^[a-z][a-z0-9_.:-]{0,127}$/u.test(current.nextSupervisionId) &&
        current.nextSupervisionId !== current.binding.supervisionId)
  );
}
