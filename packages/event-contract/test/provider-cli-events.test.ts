import { expect, it } from "vitest";
import { sanitizeEventPayload } from "../src/redaction.js";
import { validateSchema } from "@lervo/schemas";

const common = {
  provider: "codex",
  version: "0.166.0",
  executableHash: `sha256:${"a".repeat(64)}`,
  hostLabel: "mac",
};
it.each(["provider.cli.admitted", "provider.cli.rejected"] as const)(
  "redacts %s paths, prompts, credentials and raw output",
  (type) => {
    const payload =
      type === "provider.cli.admitted"
        ? {
            ...common,
            probeResultHash: `sha256:${"b".repeat(64)}`,
            admittedAt: "2026-10-31T00:00:00Z",
          }
        : {
            ...common,
            reason: "capabilities_exposed",
            exposedTools: ["exec", "spawn_agent"],
            rejectedAt: "2026-10-31T00:00:00Z",
          };
    const result = sanitizeEventPayload(type, {
      ...payload,
      executable: "/private/provider",
      prompt: "private prompt",
      credentials: "secret",
      output: "raw provider output",
    });
    expect(result.payload).toEqual(payload);
    expect(JSON.stringify(result.payload)).not.toContain("private");
  },
);
it("rejects open tool names, reasons, absolute versions and extra fields", () => {
  const payload = {
    ...common,
    reason: "capabilities_exposed",
    exposedTools: ["exec"],
    rejectedAt: "2026-10-31T00:00:00Z",
  };
  expect(validateSchema("providerCliRejectedEventPayload", payload).valid).toBe(true);
  for (const override of [
    { exposedTools: ["/owner/private"] },
    { reason: "arbitrary output" },
    { version: "/owner/version" },
    { executable: "/provider" },
  ])
    expect(
      validateSchema("providerCliRejectedEventPayload", { ...payload, ...override }).valid,
    ).toBe(false);
});
