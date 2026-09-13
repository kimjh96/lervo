import { afterEach, describe, expect, it } from "vitest";
import { rm, writeFile } from "node:fs/promises";
import { createLoginFixture } from "../../adapter-contract/test/login.fixture.js";
import { inspectCodexLogin } from "../src/login-inspection.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe("codex native login inspection", () => {
  it.each(["present", "api_key", "absent", "malformed", "conflict", "overflow"])(
    "normalizes %s without retaining account or credential fields",
    async (state) => {
      const f = await createLoginFixture(roots);
      await writeFile(f.statePath, state);
      const previous = process.env.LERVO_LOGIN_PROBE_SECRET;
      process.env.LERVO_LOGIN_PROBE_SECRET = "must-not-reach-child";
      let result;
      try {
        result = await inspectCodexLogin(f.executable, f.context);
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
      expect(result.provider).toBe("codex");
    },
  );
});
