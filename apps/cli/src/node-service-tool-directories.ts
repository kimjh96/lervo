import { loadNodeRuntimeConfig } from "@lervo/node-runtime";

import {
  resolveServiceToolDirectories,
  type ServiceProvider,
  type ServiceToolDirectories,
} from "./service-tool-directories.js";

/**
 * ADR-0470: the tool directories a repository Node service needs on its PATH — the provider of
 * outcome supervision, `git`, and
 * optionally `gh` — resolved against the planning shell's PATH.
 */
export async function nodeServiceToolDirectories(input: {
  repositoryRoot: string;
  configPath: string;
  searchPath?: string | undefined;
}): Promise<ServiceToolDirectories> {
  const providers: ServiceProvider[] = [];
  const supervision = await loadNodeRuntimeConfig(input.configPath).then(
    (config) => config.outcomeSupervision?.ownerReasoning.provider,
    () => undefined,
  );
  if (supervision === "codex" || supervision === "claude") providers.push(supervision);
  return resolveServiceToolDirectories({
    providers,
    searchPath: input.searchPath ?? process.env.PATH,
  });
}
