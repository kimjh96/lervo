import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as codex from "@lervo/adapter-codex";
import { vi } from "vitest";

/** Advances lease time in both the supervisor and its otherwise isolated managed CLI. */
export async function createSupervisionExpiryClock(root: string) {
  const nativeDate = Date;
  const offsetPath = resolve(root, "test-clock-offset.json");
  const preload = resolve(root, "test-clock.cjs");
  await writeFile(offsetPath, "0");
  await writeFile(
    preload,
    `const fs = require("node:fs");
const NativeDate = Date;
const offset = () => JSON.parse(fs.readFileSync(${JSON.stringify(offsetPath)}, "utf8"));
global.Date = class extends NativeDate {
  constructor(...args) { super(...(args.length ? args : [NativeDate.now() + offset()])); }
  static now() { return NativeDate.now() + offset(); }
};
`,
  );
  class ClockDate extends nativeDate {
    constructor(value?: string | number | Date) {
      super(
        value === undefined
          ? ClockDate.now()
          : value instanceof nativeDate
            ? value.getTime()
            : value,
      );
    }
    static override now() {
      return nativeDate.now() + JSON.parse(readFileSync(offsetPath, "utf8"));
    }
  }
  vi.stubGlobal("Date", ClockDate);
  const originalEnvironment = codex.codexStoredLoginEnvironment;
  const nodeOptions = `--require=${JSON.stringify(preload)}`;
  const environmentSpy = vi
    .spyOn(codex, "codexStoredLoginEnvironment")
    .mockImplementation((context) => ({
      ...originalEnvironment(context),
      NODE_OPTIONS: nodeOptions,
    }));
  return {
    async advancePast(expiresAt: string) {
      await writeFile(offsetPath, String(nativeDate.parse(expiresAt) + 50 - nativeDate.now()));
      const childNow = Number(
        execFileSync(process.execPath, ["-e", "process.stdout.write(String(Date.now()))"], {
          encoding: "utf8",
          env: { ...process.env, NODE_OPTIONS: nodeOptions },
        }),
      );
      if (childNow <= nativeDate.parse(expiresAt) || Date.now() <= nativeDate.parse(expiresAt))
        throw new Error("The supervisor and managed CLI did not observe lease expiry.");
    },
    close() {
      environmentSpy.mockRestore();
      vi.unstubAllGlobals();
    },
  };
}
