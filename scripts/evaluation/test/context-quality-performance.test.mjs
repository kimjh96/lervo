import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { interval, qualify } from "../lib/context-quality-performance-report.mjs";

const protocol = {
  warmPairs: 2,
  coldPairs: 2,
  warmupCallsPerWarmProcess: 1,
  measuredCallsPerWarmProcess: 2,
  noninferiority: {
    meanPreparationAddedMsUpper95: 10,
    meanProcessTimeRatioUpper95: 1.2,
    meanPeakRssRatioUpper95: 1.25,
  },
};
function cohort(added = 1) {
  return ["warm", "cold"].flatMap((lifecycle) =>
    [0, 1].flatMap((pair) =>
      ["control", "candidate"].map((arm) => {
        const sample = {
          elapsedMs: 10 + (arm === "candidate" ? added : 0),
          cpuMs: 1,
          status: "incomplete",
          planDigest: "same",
          preparedBytes: 42,
          recording: arm === "candidate" ? "writer_not_active" : null,
        };
        return {
          lifecycle,
          pair,
          arm,
          status: "completed",
          processMs: 100,
          resourceUsage: { maxRSS: 100 },
          samples: Array.from({ length: lifecycle === "warm" ? 2 : 1 }, () => ({ ...sample })),
          warmups: lifecycle === "warm" ? [{ ...sample }] : [],
        };
      }),
    ),
  );
}
const evaluate = (rows, config = protocol, final = "build") =>
  qualify(rows, config, "build", final);

describe("context quality performance qualification", () => {
  it("accepts a complete paired cohort within every frozen gate", () => {
    expect(evaluate(cohort()).qualified).toBe(true);
    expect(evaluate(cohort()).summaries[1].preparationAddedMs).toEqual({
      mean: 1,
      lower95: 1,
      upper95: 1,
    });
  });
  it.each([
    ["empty cohort", (rows) => rows.splice(0)],
    ["missing candidate", (rows) => rows.pop()],
    [
      "duplicate pair",
      (rows) => {
        rows[3] = structuredClone(rows[1]);
      },
    ],
    [
      "failed process",
      (rows) => {
        rows[0].status = "failed";
        delete rows[0].samples;
      },
    ],
    [
      "cancelled process",
      (rows) => {
        rows[0].status = "cancelled";
      },
    ],
    [
      "missing samples",
      (rows) => {
        rows[0].samples = [];
      },
    ],
    [
      "nonfinite duration",
      (rows) => {
        rows[0].samples[0].elapsedMs = NaN;
      },
    ],
    [
      "zero denominator",
      (rows) => {
        rows[0].processMs = 0;
      },
    ],
    [
      "changed digest",
      (rows) => {
        rows[0].samples[0].planDigest = "different";
      },
    ],
    [
      "contradictory status",
      (rows) => {
        rows[0].samples[0].status = "unavailable";
      },
    ],
    [
      "changed bytes",
      (rows) => {
        rows[0].samples[0].preparedBytes++;
      },
    ],
    [
      "warmup recording mismatch",
      (rows) => {
        rows[0].warmups[0].recording = "recorded";
      },
    ],
    [
      "unexpected lifecycle",
      (rows) => {
        rows.push({ ...rows[0], lifecycle: "unknown" });
      },
    ],
  ])("rejects %s without dropping evidence", (_, mutate) => {
    const rows = cohort();
    mutate(rows);
    const before = structuredClone(rows);
    expect(evaluate(rows).qualified).toBe(false);
    expect(rows).toEqual(before);
  });
  it("rejects changed and unexpected builds", () => {
    expect(evaluate(cohort(), protocol, "changed").qualified).toBe(false);
    expect(
      evaluate(cohort(), { ...protocol, expectedArtifactBuildHash: "expected" }).qualified,
    ).toBe(false);
  });
  it("enforces all three independent resource gates", () => {
    expect(evaluate(cohort(11)).qualified).toBe(false);
    for (const field of ["processMs", "maxRSS"]) {
      const rows = cohort();
      for (const row of rows.filter((r) => r.arm === "candidate")) {
        if (field === "processMs") row.processMs = 130;
        else row.resourceUsage.maxRSS = 130;
      }
      expect(evaluate(rows).qualified).toBe(false);
    }
  });
  it("rejects empty or nonfinite bootstrap populations", () => {
    expect(() => interval([])).toThrow();
    expect(() => interval([Infinity])).toThrow();
  });
  it("reproduces the retained rejected cohort with the frozen calculation", async () => {
    const old = JSON.parse(
      await readFile(
        new URL(
          "../../../docs/evidence/quality/context-quality-recording-overhead-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const result = qualify(old.results, old.protocol, old.artifactBuildHash, old.artifactBuildHash);
    expect(result.qualified).toBe(false);
    expect(result.summaries).toEqual(old.summaries);
    expect(result.semanticParity).toBe(true);
    expect(result.recordingBehavior).toBe(true);
  });
});

it("losslessly decodes every retained CPU counter in the compact diagnostic evidence", async () => {
  const { createHash } = await import("node:crypto");
  const report = JSON.parse(
    await readFile(
      new URL(
        "../../../docs/evidence/quality/context-quality-cold-recording-diagnosis-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const { cpuTimesColumns, decodedJsonSha256 } = report.storageEncoding;
  delete report.storageEncoding;
  for (const row of report.results)
    for (const host of [row.hostBefore, row.hostAfter]) {
      host.cpuTimes = host.cpuTimes.map((cpu) =>
        Object.fromEntries(cpuTimesColumns.map((key, index) => [key, cpu[index]])),
      );
    }
  expect(createHash("sha256").update(JSON.stringify(report)).digest("hex")).toBe(decodedJsonSha256);
});
