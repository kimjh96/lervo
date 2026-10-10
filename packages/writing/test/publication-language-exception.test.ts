import { expect, it } from "vitest";
import {
  resolveArtifactWritingContract,
  type PublicationLanguageException,
} from "../src/publication-language-exception.js";
const hash = `sha256:${"a".repeat(64)}`;
const exception: PublicationLanguageException = {
  exceptionId: "explicit.ko",
  ruleId: "writing_en-human",
  planDigest: hash,
  artifactPath: "docs/result.md",
  definitionId: "publication.v1",
  language: "ko",
  authorityEvidenceDigest: hash,
};
const input = {
  language: "en",
  planDigest: hash,
  artifactPath: exception.artifactPath,
  definitionId: exception.definitionId,
};
it("keeps English default and preserves required checks under an authorized bounded exception", async () => {
  const base = await resolveArtifactWritingContract(input);
  const overridden = await resolveArtifactWritingContract({
    ...input,
    exception,
    authorizeException: async () => true,
  });
  expect(base.locale).toBe("en");
  expect(overridden.locale).toBe("ko");
  expect(overridden.verification.deterministicChecks).toEqual(
    base.verification.deterministicChecks,
  );
  expect(overridden.verification.semanticChecks).toHaveLength(
    base.verification.semanticChecks.length,
  );
  expect(overridden.verification.semanticChecks.every((check) => check.required)).toBe(true);
});
it.each(["missing", "denied", "path", "plan", "definition", "rule"])(
  "rejects %s exception authority or scope",
  async (kind) => {
    const changed = { ...exception };
    if (kind === "path") changed.artifactPath = "other.md";
    if (kind === "plan") changed.planDigest = `sha256:${"b".repeat(64)}`;
    if (kind === "definition") changed.definitionId = "other";
    if (kind === "rule") Object.assign(changed, { ruleId: "other" });
    await expect(
      resolveArtifactWritingContract({
        ...input,
        exception: changed,
        ...(kind === "missing" ? {} : { authorizeException: async () => kind !== "denied" }),
      }),
    ).rejects.toThrow();
  },
);
it("changes writing-policy identity when the authorized exception scope changes", async () => {
  const a = await resolveArtifactWritingContract({
    ...input,
    exception,
    authorizeException: async () => true,
  });
  const b = await resolveArtifactWritingContract({
    ...input,
    artifactPath: "other.md",
    exception: { ...exception, artifactPath: "other.md" },
    authorizeException: async () => true,
  });
  expect(a.writingPolicyId).not.toBe(b.writingPolicyId);
});
