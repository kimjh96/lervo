import { isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { FileSystemCas } from "@lervo/cas";
import { MAX_RESEARCH_INPUT_BYTES, verifyResearchBrief, type ResearchInputsV1 } from "@lervo/roles";
import type { CliIo } from "./types.js";

export const researchUsage =
  "  lervo research verify [--artifact <sha256>] [--inputs <sha256>] [--cas <absolute-path>] [--json]";

/** A verification subprocess reads exact host-bound CAS inputs; it never prepares or executes research. */
export async function runResearchCommand(
  args: string[],
  io: CliIo,
  environment: Readonly<Record<string, string | undefined>> = process.env,
  now: () => string = () => new Date().toISOString(),
) {
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        artifact: { type: "string" },
        inputs: { type: "string" },
        cas: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${researchUsage}\n`);
      return 0;
    }
    if (parsed.positionals.join(",") !== "verify") throw new Error("Specify research verify.");
    const artifactHash = parsed.values.artifact ?? environment.LERVO_RESEARCH_ARTIFACT_HASH;
    const inputHash = parsed.values.inputs ?? environment.LERVO_RESEARCH_INPUT_HASH;
    const root = parsed.values.cas ?? environment.LERVO_RESEARCH_CAS_ROOT;
    if (
      !root ||
      !isAbsolute(root) ||
      ![artifactHash, inputHash].every(
        (hash) => typeof hash === "string" && /^sha256:[a-f0-9]{64}$/u.test(hash),
      )
    )
      throw new Error("Research verification requires exact artifact/input hashes and a CAS root.");
    const cas = await FileSystemCas.openReadOnly(root);
    const original = await cas.get(`lervo-cas://sha256/${inputHash!.slice(7)}`);
    const result = await cas.get(`lervo-cas://sha256/${artifactHash!.slice(7)}`);
    if (original.byteLength > MAX_RESEARCH_INPUT_BYTES || result.byteLength > 65536)
      throw new Error("The research verification inputs exceed their byte bounds.");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const {
      body: _body,
      manifest: _manifest,
      ...report
    } = verifyResearchBrief({
      content: decoder.decode(result),
      inputs: JSON.parse(decoder.decode(original)) as ResearchInputsV1,
      now: now(),
    });
    if (report.inputHash !== inputHash || report.resultContentHash !== artifactHash)
      throw new Error("Research verification differs from the requested exact artifacts.");
    io.stdout(`${JSON.stringify(report)}\n`);
    return 0;
  } catch {
    io.stderr("Research artifact schema or source traceability verification failed.\n");
    return 1;
  }
}
