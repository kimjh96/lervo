import { describe, expect, it } from "vitest";

import {
  decisionPrompt,
  proposalPrompt,
  publicationRepairPrompt,
  reviewPrompt,
  revisionPrompt,
  verificationPrompt,
} from "../src/deliberation-prompts.js";

const role = {
  name: "Technical decision",
  description: "Makes a bounded repository decision.",
};

describe("deliberation prompts", () => {
  it("requires plain definitions and repository-relative evidence in every publishable turn", () => {
    const prompts = [
      proposalPrompt("Choose hybrid retrieval.", role, "en"),
      reviewPrompt("Choose hybrid retrieval.", 1, role, "en"),
      revisionPrompt("Choose hybrid retrieval.", role, "en"),
      verificationPrompt("Choose hybrid retrieval.", "project.quick", role, "en"),
      decisionPrompt("Choose hybrid retrieval.", role, "en"),
    ];

    for (const prompt of prompts) {
      expect(prompt).toContain("does not already know this repository's internal vocabulary");
      expect(prompt).toContain("define every necessary abbreviation");
      expect(prompt).toContain("machine identifiers");
      expect(prompt).toContain("Use repository-relative evidence references");
      expect(prompt).not.toContain("/Users/");
    }
    expect(prompts[0]).toContain("under 700 words");
    expect(prompts[1]).toContain("under 600 words");
    expect(prompts[0]).toContain("add a Terms section");
  });

  it("gives one failed publication a bounded plain-language repair instruction", () => {
    const prompt = publicationRepairPrompt("Review the proposal.");
    expect(prompt).toContain("Review the proposal.");
    expect(prompt).toContain("previous independent draft");
    expect(prompt).toContain("audit every repository-specific term");
  });
});
