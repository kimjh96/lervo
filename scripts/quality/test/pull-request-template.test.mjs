import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, it } from "vitest";

import { defaultEnglishWritingContract, lintDeterministicWriting } from "@lervo/core";

const repositoryRoot = resolve(import.meta.dirname, "../../..");
const requiredHeadings = [
  "Summary",
  "Scope and authority",
  "Contract and architecture",
  "Release impact",
  "Verification",
  "Knowledge and documentation",
  "Risk and recovery",
  "Checklist",
];

describe("repository pull-request authoring contract", () => {
  it("routes repository agents through the complete bounded review template", async () => {
    const [agents, template] = await Promise.all([
      readFile(resolve(repositoryRoot, "AGENTS.md"), "utf8"),
      readFile(resolve(repositoryRoot, ".github/PULL_REQUEST_TEMPLATE.md"), "utf8"),
    ]);

    assert.match(agents, /read \[the repository pull-request template\]/u);
    assert.match(agents, /\[`writing_en-human` policy\]/u);
    assert.match(agents, /preserve every section/iu);
    assert.match(agents, /start the body at H2/iu);
    assert.match(agents, /never[^.\n]*H1/iu);
    assert.doesNotMatch(template, /^# /mu);
    assert.match(template, /^## Summary$/mu);
    assert.match(template, /writing_en-human/u);
    for (const heading of requiredHeadings)
      assert.match(template, new RegExp(`^## ${heading}$`, "mu"));
    assert.match(template, /neither an append-only file nor a one-file-per-operation archive/u);
    assert.match(template, /must evaluate these items directly/u);
    assert.match(template, /Change an item to \[x\] only after its/u);
    assert.match(template, /Checkboxes are attestations, not substitutes for CI/u);
    assert.match(template, /Use "N\/A: <reason>" instead of deleting a section/u);
    assert.match(agents, /evaluate (?:each|every) checklist item/iu);
    assert.match(agents, /pre-checked boilerplate/u);
    assert.deepEqual(
      lintDeterministicWriting(template, defaultEnglishWritingContract).map(
        ({ checkId, status }) => ({ checkId, status }),
      ),
      defaultEnglishWritingContract.verification.deterministicChecks.map((checkId) => ({
        checkId,
        status: "passed",
      })),
    );
  });
});
