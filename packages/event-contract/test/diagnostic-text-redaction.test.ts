import { describe, expect, it } from "vitest";

import { redactDiagnosticText } from "../src/index.js";

describe("diagnostic text redaction", () => {
  it("removes credential-shaped substrings and keeps Git diagnostics readable", () => {
    const objectId = "a".repeat(40);
    const digest = redactDiagnosticText(
      [
        "fatal: unable to access 'https://user:hunter2@example.com/repo.git/'",
        "Authorization: Bearer abcdefghijklmnop",
        `error: bad object ${objectId}`,
        "password=correct-horse token: ghp_abcdefghijklmnopqrstuvwxyz0123",
        `opaque ${"Zx9".repeat(20)}`,
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
        "\u001b[31mcolour\u001b[0m",
      ].join("\n"),
    );

    expect(digest).not.toMatch(/hunter2|abcdefghijklmnop|correct-horse|ghp_|AAAA|Zx9Zx9/u);
    expect(digest).toContain("https://[redacted]@example.com");
    expect(digest).toContain(`bad object ${objectId}`);
    expect(digest).toContain("password=[redacted]");
    expect(digest).toContain("[redacted:private_key]");
    expect(digest).not.toContain("\u001b");
    expect(digest).not.toContain("\n");
  });

  it("bounds the digest to the requested length", () => {
    const digest = redactDiagnosticText("x ".repeat(2_000));
    expect(digest.length).toBeLessThanOrEqual(512);
    expect(digest.endsWith("…")).toBe(true);
    expect(() => redactDiagnosticText("x", 4)).toThrow(RangeError);
  });
});
