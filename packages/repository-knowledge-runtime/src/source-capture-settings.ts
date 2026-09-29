import { sha256 } from "@lervo/repository-knowledge";
import { parseConvergenceDelegation, CONVERGENCE_DELEGATION_PATH } from "./delegation-contract.js";
import {
  DEFAULT_REPOSITORY_SOURCE_BYTES,
  type ConvergenceSourceCapturePolicy,
} from "./source-capture-contract.js";
import { ordinaryConvergenceSourceBytes } from "./source-file.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export interface ConvergenceSourceCaptureSettings {
  policy: ConvergenceSourceCapturePolicy;
  delegationContentHash: string | null;
}

/** A valid exact reviewed object may enlarge capture; execution still revalidates active ancestry. */
export function convergenceSourceCaptureSettings(root: string): ConvergenceSourceCaptureSettings {
  let bytes: Buffer;
  try {
    bytes = ordinaryConvergenceSourceBytes(root, CONVERGENCE_DELEGATION_PATH, 64 * 1024);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        policy: { maximumRepositoryBytes: DEFAULT_REPOSITORY_SOURCE_BYTES, symbolicReferences: [] },
        delegationContentHash: null,
      };
    throw error;
  }
  let delegation;
  try {
    delegation = parseConvergenceDelegation(
      JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)),
    );
  } catch (error) {
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable", { cause: error });
  }
  return {
    policy: delegation.sourceCapture ?? {
      maximumRepositoryBytes: DEFAULT_REPOSITORY_SOURCE_BYTES,
      symbolicReferences: [],
    },
    delegationContentHash: sha256(bytes),
  };
}
