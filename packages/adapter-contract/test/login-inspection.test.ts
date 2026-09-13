import { describe, expect, it } from "vitest";
import { inspectProviderLoginProbe, providerLoginEnvironment } from "../src/index.js";

const base = {
  provider: "codex" as const,
  executable: process.execPath,
  workingDirectory: process.cwd(),
  environment: providerLoginEnvironment({
    homeDirectory: process.cwd(),
    configurationDirectory: process.cwd(),
  }),
  parse: () => "login_present" as const,
};

describe("bounded native login probes", () => {
  it("does not parse or expose timed-out output", async () => {
    expect(
      await inspectProviderLoginProbe({
        ...base,
        arguments: ["-e", "console.log('private');setInterval(()=>{},1000)"],
        timeoutMs: 100,
      }),
    ).toEqual({ provider: "codex", status: "unobserved", reasonCode: "probe_timed_out" });
  });
  it("does not accept oversized output even if the parser would accept it", async () => {
    expect(
      await inspectProviderLoginProbe({
        ...base,
        arguments: ["-e", "process.stdout.write('secret'.repeat(4096))"],
      }),
    ).toEqual({ provider: "codex", status: "unobserved", reasonCode: "probe_failed" });
  });
  it("reports an unavailable executable without native errors", async () => {
    expect(
      await inspectProviderLoginProbe({ ...base, executable: "/missing/provider", arguments: [] }),
    ).toEqual({ provider: "codex", status: "unobserved", reasonCode: "executable_not_found" });
  });
});
