import type {
  HostOutcomeArtifact,
  HostOutcomeContract,
  HostOutcomePolicy,
} from "./host-context-outcome-types.js";

/** Callback-visible values must not alias the coordinates used for verification or correction. */
export function snapshotHostArtifact(artifact: HostOutcomeArtifact): HostOutcomeArtifact {
  return artifact.kind === "immutable"
    ? { ...artifact, readBytes: artifact.readBytes.bind(artifact) }
    : {
        ...artifact,
        ...(artifact.baselineBytes === undefined
          ? {}
          : { baselineBytes: new Uint8Array(artifact.baselineBytes) }),
      };
}

export function snapshotHostPolicy(policy: HostOutcomePolicy): HostOutcomePolicy {
  return {
    resolve: policy.resolve.bind(policy),
    ...(policy.verifyAfterCorrection
      ? { verifyAfterCorrection: policy.verifyAfterCorrection.bind(policy) }
      : {}),
  };
}

/** Capture the admitted contract before artifact I/O can yield to caller-owned code. */
export function snapshotHostContract(contract: HostOutcomeContract): HostOutcomeContract {
  return {
    ...contract,
    definition: structuredClone(contract.definition),
    ...(contract.evaluator
      ? { evaluator: { evaluate: contract.evaluator.evaluate.bind(contract.evaluator) } }
      : {}),
    ...(contract.taskEvaluator
      ? {
          taskEvaluator: {
            buildId: contract.taskEvaluator.buildId,
            evaluate: contract.taskEvaluator.evaluate.bind(contract.taskEvaluator),
          },
        }
      : {}),
    ...(contract.correction
      ? {
          correction: {
            ...contract.correction,
            editable: structuredClone(contract.correction.editable),
            propose: contract.correction.propose.bind(contract.correction),
            apply: contract.correction.apply.bind(contract.correction),
          },
        }
      : {}),
  };
}
