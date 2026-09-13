import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import type { ConversationOutboundMessage } from "@lervo/schemas";
import { openNodeOutcomeSupervisionRuntime } from "../src/outcome-supervision-runtime.js";
import { SupervisionTaskSource } from "../src/supervision-task-source.js";
import { readSupervisionJsonArtifact } from "../src/supervision-artifact-json.js";
import { liveSupervisionFixture } from "./supervision-live.fixture.js";

const executable = process.env.LERVO_LIVE_SUPERVISION_PROVIDER;
const profile = process.env.LERVO_LIVE_SUPERVISION_PROFILE;
const reportPath = process.env.LERVO_LIVE_PUBLICATION_PREVIEW_REPORT;

it.skipIf(executable === undefined || profile === undefined || reportPath === undefined)(
  "freezes a real accepted result and independent publication judgement before any transport call",
  async () => {
    for (const path of [executable!, profile!, reportPath!]) expect(isAbsolute(path)).toBe(true);
    const f = await liveSupervisionFixture(executable!, profile!, { publicationPreview: true });
    const storage = await openProjectStorage(f.root);
    const now = () => new Date().toISOString();
    const startedAt = now();
    const deliver = vi.fn(async () => {
      throw new Error("Preview must stop before external delivery.");
    });
    const origin = {
      sourceEventId: `cve_${"3".repeat(64)}`,
      policyId: `cpp_${"4".repeat(64)}`,
      target: {
        integrationId: "itg_publicationpreview",
        projectId: storage.manifest.projectId,
        conversationId: "cnv_publicationpreview",
        threadId: null,
      },
      actor: { kind: "agent" as const, participantId: "ptc_previewowner", roleId: "observer" },
    };
    const runtime = await openNodeOutcomeSupervisionRuntime({
      repositoryRoot: f.root,
      binding: f.binding,
      ports: { now, recordAttention: async () => undefined },
      ownerReasoning: { provider: "codex", reservedTokens: 100000 },
      managedExecution: {
        nodeExecutable: process.execPath,
        cliBundle: resolve("apps/cli/dist/bin.js"),
      },
      runtimeReadiness: f.configuration,
      resultDelivery: {
        origin,
        adapter: {
          descriptor: {
            schemaVersion: 1,
            integrationId: origin.target.integrationId,
            adapterKind: "discord",
            instanceIdentityHash: `sha256:${"c".repeat(64)}`,
            capabilities: ["messages.send"],
          },
          deliver,
        },
      },
    });
    const cycles: unknown[] = [];
    let failure: string | null = null;
    let outbound: ConversationOutboundMessage | null = null;
    try {
      for (let index = 0; index < 24; index++) {
        const cycle = await runtime.runCycle();
        cycles.push(cycle);
        const source = await new SupervisionTaskSource(storage, f.binding, now).read();
        const queued = source.events.findLast(
          (event) => event.type === "work.supervision.delivery.queued",
        );
        if (queued !== undefined) {
          outbound = (await readSupervisionJsonArtifact(
            storage.artifacts,
            String(queued.payload.outboundArtifactHash),
          )) as ConversationOutboundMessage;
          break;
        }
        expect(
          ["blocked", "uncertain", "busy", "idle"].includes(cycle.disposition),
          JSON.stringify(cycle),
        ).toBe(false);
      }
      expect(outbound).not.toBeNull();
      expect(deliver).not.toHaveBeenCalled();
    } catch (error) {
      failure = error instanceof Error ? error.message : "publication_preview_failed";
      throw error;
    } finally {
      await runtime.close();
      const source = await new SupervisionTaskSource(storage, f.binding, now).read();
      await writeFile(
        reportPath!,
        JSON.stringify(
          {
            schemaVersion: 1,
            startedAt,
            completedAt: now(),
            repositoryRoot: f.root,
            retainedRoots: f.roots,
            binding: f.binding,
            cliBundleHash: `sha256:${createHash("sha256")
              .update(await readFile(resolve("apps/cli/dist/bin.js")))
              .digest("hex")}`,
            intake: "controlled_fixture_origin",
            providerOutcomes: "external_native_provider",
            transportCalls: deliver.mock.calls.length,
            failure,
            outbound,
            cycles,
            providerStarts: source.events.filter((event) => event.type === "adapter.started")
              .length,
            resources: source.workstreamResources,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      await storage.close();
    }
  },
  900000,
);
