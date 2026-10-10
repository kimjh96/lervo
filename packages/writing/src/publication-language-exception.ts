import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import { writingContractForLanguage } from "@lervo/core";
import type { WritingContract } from "@lervo/schemas";

export interface PublicationLanguageException {
  exceptionId: string;
  ruleId: "writing_en-human";
  planDigest: string;
  artifactPath: string;
  definitionId: string;
  language: string;
  authorityEvidenceDigest: string;
}

/** This scoped override never changes repository publication defaults or grants write authority. */
export async function resolveArtifactWritingContract(input: {
  language: string;
  planDigest: string;
  artifactPath: string;
  definitionId: string;
  exception?: PublicationLanguageException;
  authorizeException?: (exception: PublicationLanguageException) => Promise<boolean>;
}): Promise<WritingContract> {
  const contract = writingContractForLanguage(input.language);
  if (!input.exception) return contract;
  const exception = structuredClone(input.exception);
  if (
    Object.keys(exception).sort().join(",") !==
      "artifactPath,authorityEvidenceDigest,definitionId,exceptionId,language,planDigest,ruleId" ||
    !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(exception.exceptionId) ||
    !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(exception.language) ||
    !/^sha256:[a-f0-9]{64}$/u.test(exception.authorityEvidenceDigest) ||
    exception.ruleId !== contract.writingPolicyId ||
    exception.planDigest !== input.planDigest ||
    exception.artifactPath !== input.artifactPath ||
    exception.definitionId !== input.definitionId ||
    !input.authorizeException ||
    !(await input.authorizeException(structuredClone(exception)))
  ) {
    throw new TypeError(
      "Publication language exception is unavailable or outside its authorized scope.",
    );
  }
  return {
    ...contract,
    writingPolicyId: `writing_exception-${createHash("sha256").update(canonicalJson(exception)).digest("hex")}`,
    locale: exception.language,
    verification: {
      ...contract.verification,
      semanticChecks: contract.verification.semanticChecks.map((check) =>
        check.checkId === "natural_en_prose"
          ? {
              ...check,
              checkId: "natural_exception_prose",
              requirement: `Write natural prose in locale ${exception.language}, in complete sentences and coherent paragraphs. Preserve quoted material, code and machine identifiers exactly.`,
            }
          : check,
      ),
    },
  };
}
