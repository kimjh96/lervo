import { expect, it } from "vitest";
import { validateSchema } from "@lervo/schemas";
import { sanitizeEventPayload } from "../src/index.js";

const coordinates = {
  providerSessionDigest: `sha256:${"a".repeat(64)}`,
  providerTurnDigest: null,
  observedAt: "2026-10-31T12:00:00.000Z",
};
const observed = {
  ...coordinates,
  skillId: "eli5",
  path: ".agents/skills/eli5/SKILL.md",
  contentHash: `sha256:${"b".repeat(64)}`,
  provider: "claude",
  source: "provider_transcript",
};

it("accepts complete native invocation and assessment contracts, redacting all transcript content", () => {
  const safe = sanitizeEventPayload("terminal.skill.observed", {
    ...observed,
    transcriptPath: "/private/transcript",
    prompt: "private",
    toolContent: "private",
    externalSkillId: "plugin:private",
  });
  expect(safe.payload).toEqual(observed);
  expect(safe.redactions).toHaveLength(4);
  for (const skillTelemetry of ["observed", "unavailable", "truncated"]) {
    expect(
      validateSchema("terminalSkillTurnAssessedEventPayload", {
        ...coordinates,
        skillTelemetry,
        externalSkillCount: 2,
      }).valid,
    ).toBe(true);
  }
});

it("rejects missing required evidence, absolute paths and unknown sources", () => {
  for (const field of Object.keys(observed)) {
    const incomplete: Record<string, unknown> = { ...observed };
    delete incomplete[field];
    expect(validateSchema("terminalSkillObservedEventPayload", incomplete).valid).toBe(false);
  }
  expect(
    validateSchema("terminalSkillObservedEventPayload", { ...observed, path: "/private/skill" })
      .valid,
  ).toBe(false);
  expect(
    validateSchema("terminalSkillObservedEventPayload", {
      ...observed,
      source: "instructions_followed",
    }).valid,
  ).toBe(false);
  expect(
    validateSchema("terminalSkillObservedEventPayload", { ...observed, skillId: "plugin:private" })
      .valid,
  ).toBe(false);
});
