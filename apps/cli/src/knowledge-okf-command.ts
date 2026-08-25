import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  applyOkfImportPlan,
  createOkfImportPlan,
  exportRepositoryKnowledgeToOkf,
  lintOkfBundle,
  queryOkfBundle,
  reExportOkfImportCandidate,
} from "@lervo/knowledge-okf";
import type { CliIo } from "./types.js";
import { knowledgeUsage } from "./knowledge-usage.js";

export async function runKnowledgeOkfExchange(args: string[], io: CliIo): Promise<number> {
  try {
    const command = args[0];
    if (command === "export") {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: true,
        options: {
          root: { type: "string" },
          output: { type: "string" },
          json: { type: "boolean" },
        },
      });
      if (
        parsed.positionals.length !== 1 ||
        parsed.positionals[0] !== "okf" ||
        parsed.values.output === undefined
      )
        throw new Error("export requires okf and --output <new-path>.");
      const result = await exportRepositoryKnowledgeToOkf({
        repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
        outputRoot: resolve(io.cwd, parsed.values.output),
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Exported the OKF v0.2 bundle to a new path.\noutput: ${result.outputRoot}\nbundle: ${result.bundleDigest}\nconcept ${result.conceptCount} · file ${result.fileCount}\nNative publications and sidecars were not changed.\n`,
      );
      return 0;
    }
    if (command === "import") {
      const parsed = parseArgs({
        args: args.slice(1),
        strict: true,
        allowPositionals: true,
        options: { root: { type: "string" }, apply: { type: "string" }, json: { type: "boolean" } },
      });
      if (parsed.positionals.length !== 2 || parsed.positionals[0] !== "okf")
        throw new Error("import requires okf and a bundle path.");
      const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
      const bundleRoot = resolve(io.cwd, parsed.positionals[1]!);
      const plan = await createOkfImportPlan({ repositoryRoot, bundleRoot });
      if (parsed.values.apply === undefined) {
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(plan, null, 2)}\n`
            : `OKF import plan: ${plan.status}\nplan: ${plan.planId}\nbundle: ${plan.bundleDigest}\nfile ${plan.fileCount} · concept ${plan.conceptCount} · unknown metadata concept ${plan.unknownMetadataConceptCount}\n${plan.externalHumanVerifiedCount} externally human-verified concepts remain local assurance unreviewed.\nNo files or events have been changed. Use --apply ${plan.planId} to apply.\n`,
        );
        return 0;
      }
      const receipt = await applyOkfImportPlan({
        repositoryRoot,
        bundleRoot,
        planId: parsed.values.apply,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(receipt, null, 2)}\n`
          : `OKF import candidate ${receipt.created ? "recorded" : "reused"}.\ncandidate: ${receipt.candidateId}\npath: ${receipt.candidatePath}\nExternal verification remains local assurance unreviewed. Publications and events were not changed.\n`,
      );
      return 0;
    }
    if (command === "okf") {
      const operation = args[1];
      if (operation === "lint") {
        const parsed = parseArgs({
          args: args.slice(2),
          strict: true,
          allowPositionals: true,
          options: { json: { type: "boolean" } },
        });
        if (parsed.positionals.length !== 1) throw new Error("okf lint requires one bundle path.");
        const result = await lintOkfBundle(resolve(io.cwd, parsed.positionals[0]!));
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `OKF lint: ${result.valid ? "passed" : "failed"} · concept ${result.checkedConcepts}\n${result.issues.map((item) => `  [${item.code}] ${item.message}`).join("\n")}${result.issues.length === 0 ? "" : "\n"}`,
        );
        return result.valid ? 0 : 1;
      }
      if (operation === "query") {
        const parsed = parseArgs({
          args: args.slice(2),
          strict: true,
          allowPositionals: true,
          options: { json: { type: "boolean" } },
        });
        if (parsed.positionals.length < 2)
          throw new Error("okf query requires a bundle path and query.");
        const result = await queryOkfBundle({
          bundleRoot: resolve(io.cwd, parsed.positionals[0]!),
          query: parsed.positionals.slice(1).join(" "),
        });
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `OKF query recommendations: ${result.hits.length} (not evidence of use)\n${result.hits.map((hit) => `  ${hit.score} ${hit.title} · ${hit.externalTrust}/local unreviewed`).join("\n")}${result.hits.length === 0 ? "" : "\n"}`,
        );
        return 0;
      }
      if (operation === "re-export") {
        const parsed = parseArgs({
          args: args.slice(2),
          strict: true,
          allowPositionals: true,
          options: {
            root: { type: "string" },
            output: { type: "string" },
            json: { type: "boolean" },
          },
        });
        if (parsed.positionals.length !== 1 || parsed.values.output === undefined)
          throw new Error("okf re-export requires a candidate ID and --output <new-path>.");
        const result = await reExportOkfImportCandidate({
          repositoryRoot: resolve(io.cwd, parsed.values.root ?? "."),
          candidateId: parsed.positionals[0]!,
          outputRoot: resolve(io.cwd, parsed.values.output),
        });
        io.stdout(
          parsed.values.json
            ? `${JSON.stringify(result, null, 2)}\n`
            : `Exported the preserved OKF candidate as a byte-identical bundle.\noutput: ${result.outputRoot}\nbundle: ${result.bundleDigest} · file ${result.fileCount}\n`,
        );
        return 0;
      }
    }
    throw new Error("Unsupported OKF exchange command.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${knowledgeUsage}\n`);
    return 1;
  }
}
