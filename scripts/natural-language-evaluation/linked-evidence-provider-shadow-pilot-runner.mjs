import { ClaudeAdapter } from "../../packages/adapter-claude/dist/index.js";
import { CodexAdapter } from "../../packages/adapter-codex/dist/index.js";

import { executeProviderShadowV2Pilot } from "./linked-evidence-provider-shadow-pilot-v2-execution.mjs";
import { prepareProviderShadowV2Pilot } from "./linked-evidence-provider-shadow-pilot-v2-preparation.mjs";
import { recoverProviderShadowV2Unavailable } from "./linked-evidence-provider-shadow-pilot-v2-recovery.mjs";
import { reviewProviderShadowV2Pilot } from "./linked-evidence-provider-shadow-pilot-v2-review.mjs";

function createAdapter(provider, root, model, options = {}) {
  if (provider === "codex") {
    return new CodexAdapter({
      repositoryRoot: root,
      model,
      sandbox: "read-only",
      approvalPolicy: "never",
      ...(options.structuredOutputSchema === undefined
        ? {}
        : { structuredOutputSchema: options.structuredOutputSchema }),
    });
  }
  if (provider === "claude") {
    return new ClaudeAdapter({
      repositoryRoot: root,
      model,
      permissionMode: "plan",
      tools: [],
      ...(options.structuredOutputSchema === undefined
        ? {}
        : { structuredOutputSchema: options.structuredOutputSchema }),
    });
  }
  throw new TypeError(`Unsupported provider arm: ${provider}`);
}

function selectionCarrier(provider, output) {
  if (output === "provider_native_exact_e4_token_set") {
    return provider === "claude" ? "json_schema_e4_token_array" : "standalone_e4_comments";
  }
  return output === "structured_exact_e4_token_array"
    ? "json_schema_e4_token_array"
    : "standalone_e4_comments";
}

function progress(value) {
  process.stderr.write(`${JSON.stringify(value)}\n`);
}

export async function runProviderShadowPilot(repositoryRoot, contractPath, operation) {
  if (operation === "prepare") {
    const prepared = await prepareProviderShadowV2Pilot(repositoryRoot, contractPath);
    return {
      status: "prepared",
      pilotId: prepared.manifest.pilotId,
      manifestDigest: prepared.manifestDigest,
      scheduleCount: prepared.manifest.schedule.length,
      sourceSampleCount: prepared.loaded.contract.sourcePopulation.expectedShadowSampleCount,
      maximumCandidateSources: prepared.manifest.maximumCandidateSources,
      maximumProviderVisibleSourceBytes: prepared.manifest.maximumProviderVisibleSourceBytes,
      providerCalls: prepared.manifest.providerCalls,
      providerArms: prepared.manifest.providers,
    };
  }
  if (operation === "execute")
    return executeProviderShadowV2Pilot(
      repositoryRoot,
      contractPath,
      createAdapter,
      selectionCarrier,
      progress,
    );
  if (operation === "recover")
    return recoverProviderShadowV2Unavailable(repositoryRoot, contractPath);
  if (operation === "review") return reviewProviderShadowV2Pilot(repositoryRoot, contractPath);
  throw new TypeError("Use prepare, execute, recover, or review.");
}
