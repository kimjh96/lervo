import { afterEach, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLoginFixture } from "../../adapter-contract/test/login.fixture.js";
import { inspectClaudeLogin } from "../src/login-inspection.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("claude native login inspection", () => {
  it.each(["present", "api_key", "absent", "malformed", "conflict", "overflow"])(
    "normalizes %s without retaining account or credential fields",
    async (state) => {
      const f = await createLoginFixture(roots);
      await writeFile(f.statePath, state);
      const previous = process.env.LERVO_LOGIN_PROBE_SECRET;
      process.env.LERVO_LOGIN_PROBE_SECRET = "must-not-reach-child";
      let result;
      try {
        result = await inspectClaudeLogin(f.executable, f.context);
      } finally {
        if (previous === undefined) delete process.env.LERVO_LOGIN_PROBE_SECRET;
        else process.env.LERVO_LOGIN_PROBE_SECRET = previous;
      }
      expect(result.status).toBe(
        state === "present" || state === "api_key"
          ? "login_present"
          : state === "absent"
            ? "login_absent"
            : "unobserved",
      );
      expect(Object.keys(result).sort()).toEqual(["provider", "reasonCode", "status"]);
      expect(result.provider).toBe("claude");
    },
  );

  it.each([
    ["malformed", 60 * 60_000, "login_present"],
    ["malformed", -1, "unobserved"],
    ["absent", 60 * 60_000, "login_absent"],
  ] as const)(
    "treats an unanswered %s probe with a refreshable stored login as present (%d ms)",
    async (state, refreshLifetimeMs, expected) => {
      const f = await createLoginFixture(roots);
      await writeFile(f.statePath, state);
      const now = 1_800_000_000_000;
      await writeFile(
        resolve(f.context.configurationDirectory, ".credentials.json"),
        JSON.stringify({
          claudeAiOauth: {
            accessToken: "expired-access",
            expiresAt: now - 1,
            refreshToken: "refresh-secret",
            refreshTokenExpiresAt: now + refreshLifetimeMs,
          },
        }),
      );
      const result = await inspectClaudeLogin(f.executable, f.context, () => now);
      expect(result.status).toBe(expected);
      expect(JSON.stringify(result)).not.toContain("secret");
    },
  );
  it("answers a hung status probe from the stored login within the five-second readiness window", async () => {
    const f = await createLoginFixture(roots);
    await writeFile(f.statePath, "hang");
    const now = 1_800_000_000_000;
    await writeFile(
      resolve(f.context.configurationDirectory, ".credentials.json"),
      JSON.stringify({
        claudeAiOauth: { refreshToken: "refresh-secret", refreshTokenExpiresAt: now + 60 * 60_000 },
      }),
    );
    const started = Date.now();
    const result = await inspectClaudeLogin(f.executable, f.context, () => now);
    expect(result.status).toBe("login_present");
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
