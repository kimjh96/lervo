import type { ClaudeAdapterOptions } from "@lervo/adapter-claude";
import type { CodexAdapterOptions, CodexTurnStartOptions } from "@lervo/adapter-codex";
import type { ProviderJsonRequest } from "@lervo/repository-knowledge-compiler";
import { providerOutputSchema } from "@lervo/schemas";
import { expect, it } from "vitest";

/**
 * ADR-0608: every provider boundary accepts only a schema `providerOutputSchema` checked. These
 * assignments are type tests: each `@ts-expect-error` fails the typecheck if its boundary ever
 * accepts an unchecked schema again.
 */
it("refuses an unchecked schema at every provider boundary, by type", () => {
  const unchecked = { type: "object", properties: { decision: { type: "string" } } };
  const checked = providerOutputSchema(unchecked);
  const claude: Pick<ClaudeAdapterOptions, "structuredOutputSchema"> = {
    // @ts-expect-error A plain object is not a ProviderOutputSchema.
    structuredOutputSchema: unchecked,
  };
  const codex: Pick<CodexAdapterOptions, "structuredOutputSchema"> = {
    // @ts-expect-error A plain object is not a ProviderOutputSchema.
    structuredOutputSchema: unchecked,
  };
  const turn: CodexTurnStartOptions = {
    // @ts-expect-error A plain object is not a ProviderOutputSchema.
    outputSchema: unchecked,
  };
  const request: ProviderJsonRequest = {
    // @ts-expect-error A plain object is not a ProviderOutputSchema.
    responseContract: { schemaVersion: 1, schema: unchecked },
  };
  // The checked schema passes every boundary, unchanged.
  const accepted: [
    Pick<ClaudeAdapterOptions, "structuredOutputSchema">,
    Pick<CodexAdapterOptions, "structuredOutputSchema">,
    CodexTurnStartOptions,
    ProviderJsonRequest,
  ] = [
    { structuredOutputSchema: checked },
    { structuredOutputSchema: checked },
    { outputSchema: checked },
    { responseContract: { schemaVersion: 1, schema: checked } },
  ];
  expect(checked).toBe(unchecked);
  expect([claude, codex, turn, request, ...accepted]).toHaveLength(8);
});
