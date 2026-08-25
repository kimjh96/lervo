import { resolve } from "node:path";

import { createFileReleaseStagePublicationStore } from "./file-release-stage-publication-store.mjs";
import { repositoryRoot } from "./installed-cli.mjs";
import { prepareNpmTrustedStagePublisher } from "./npm-trusted-stage-publisher.mjs";
import { executeReleaseStagePublication } from "./release-stage-publication-execution.mjs";
import { readReleaseStagePublicationSources } from "./release-stage-publication-sources.mjs";

export async function stageCliReleasePublication(options, dependencies = {}) {
  const readSources = dependencies.readSources ?? readReleaseStagePublicationSources;
  const createStore = dependencies.createStore ?? createFileReleaseStagePublicationStore;
  const execute = dependencies.execute ?? executeReleaseStagePublication;
  const prepareStage =
    dependencies.prepareStage ??
    ((input) =>
      prepareNpmTrustedStagePublisher(input, {
        npmCommand: resolve(
          repositoryRoot,
          "node_modules",
          ".bin",
          process.platform === "win32" ? "npm.cmd" : "npm",
        ),
      }));
  const source = await readSources(options);
  return execute(source, {
    store: createStore({ rootDirectory: options.resultDirectory }),
    prepareStage,
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
  });
}
