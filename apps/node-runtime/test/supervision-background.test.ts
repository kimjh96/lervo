import { rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { supervisionFixture } from "./supervision.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("reopens the background owner from durable evidence without replaying a confirmed effect", async () => {
  const f = await supervisionFixture(roots);
  for (let attempt = 0; attempt < 2; attempt++) {
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: f.ports,
    });
    let complete!: (disposition: string) => void;
    let fail!: (error: unknown) => void;
    const firstCycle = new Promise<string>((resolve, reject) => {
      complete = resolve;
      fail = reject;
    });
    try {
      const options = {
        onFailure: fail,
        onCycle: (result: { disposition: string }) => {
          complete(result.disposition);
        },
      };
      runtime.start(options);
      runtime.start(options);
      expect(await firstCycle).toBe("effect_confirmed");
    } finally {
      await runtime.close();
    }
    expect(() => runtime.start({ onFailure: fail })).toThrow("supervision_session_closed");
  }
  expect(f.counts().effects).toBe(1);
});
