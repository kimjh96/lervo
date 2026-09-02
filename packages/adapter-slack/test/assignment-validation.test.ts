import { expect, it } from "vitest";

import { assertSlackWritingPermit, decodeSlackArtifact } from "../src/assignment-validation.js";
import {
  ARTIFACT_BYTES,
  ARTIFACT_ID,
  CONTENT_HASH,
  FIXTURE_PERMIT,
  PERMIT_HASH,
} from "./assignment-fixture.js";

it("accepts only the exact bounded UTF-8 artifact bytes", () => {
  expect(decodeSlackArtifact(ARTIFACT_BYTES, CONTENT_HASH)).toBe(
    "Review the verified assignment handoff.",
  );
  expect(() => decodeSlackArtifact(ARTIFACT_BYTES, `sha256:${"f".repeat(64)}`)).toThrowError(
    expect.objectContaining({ code: "artifact_invalid" }),
  );
  expect(() => decodeSlackArtifact(new Uint8Array(16 * 1024 + 1), CONTENT_HASH)).toThrowError(
    expect.objectContaining({ code: "artifact_invalid" }),
  );
});

it("rejects a publication permit whose content-bound evidence drifts", () => {
  expect(() =>
    assertSlackWritingPermit({
      permit: FIXTURE_PERMIT,
      permitId: FIXTURE_PERMIT.permitId,
      permitHash: PERMIT_HASH,
      artifactId: ARTIFACT_ID,
      contentHash: CONTENT_HASH,
    }),
  ).not.toThrow();
  expect(() =>
    assertSlackWritingPermit({
      permit: { ...FIXTURE_PERMIT, evaluationHash: `sha256:${"f".repeat(64)}` },
      permitId: FIXTURE_PERMIT.permitId,
      permitHash: PERMIT_HASH,
      artifactId: ARTIFACT_ID,
      contentHash: CONTENT_HASH,
    }),
  ).toThrowError(expect.objectContaining({ code: "permit_invalid" }));
});
