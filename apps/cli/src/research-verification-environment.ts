import { realpath } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { VerificationSuite } from "@lervo/schemas";

const variables = [
  "LERVO_RESEARCH_ARTIFACT_HASH",
  "LERVO_RESEARCH_CAS_ROOT",
  "LERVO_RESEARCH_INPUT_HASH",
];

/** Binds the repository suite to this CLI's checker and supplies only exact CAS coordinates. */
export async function prepareResearchVerificationEnvironment(input: {
  suite: VerificationSuite;
  inputArtifactHash: string;
  casRoot: string;
  artifactHash?: string;
  cliModuleUrl?: string;
  nodeExecutable?: string;
}) {
  const moduleUrl = input.cliModuleUrl ?? import.meta.url;
  const modulePath = fileURLToPath(moduleUrl);
  const cli =
    basename(modulePath) === "bin.js"
      ? modulePath
      : fileURLToPath(new URL("../dist/bin.js", moduleUrl));
  const command = input.suite.commands[0];
  if (
    input.suite.suiteId !== "role.research.artifact" ||
    input.suite.commands.length !== 1 ||
    command === undefined ||
    command.commandId !== "research-artifact" ||
    command.executable !== "node" ||
    command.cwd !== "." ||
    command.arguments.length !== 4 ||
    command.arguments.slice(1).join(",") !== "research,verify,--json" ||
    command.environmentVariableNames.slice().sort().join(",") !== variables.join(",") ||
    (await realpath(command.arguments[0]!)) !== (await realpath(cli))
  )
    throw new Error(
      "The research verification suite must invoke the exact installed CLI research checker.",
    );
  return {
    PATH: dirname(input.nodeExecutable ?? process.execPath),
    LERVO_RESEARCH_INPUT_HASH: input.inputArtifactHash,
    LERVO_RESEARCH_CAS_ROOT: input.casRoot,
    ...(input.artifactHash === undefined
      ? {}
      : { LERVO_RESEARCH_ARTIFACT_HASH: input.artifactHash }),
  };
}
