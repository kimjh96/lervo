import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { openProjectStorage } from "@lervo/project-storage";
import { sha256 } from "@lervo/repository-knowledge";

const root = process.env.LERVO_AXLI_SKILL_OBSERVATION_ROOT;
const contextEventId = process.env.LERVO_AXLI_SKILL_OBSERVATION_CONTEXT;

/** Opt-in installed acceptance. Configure only after a real Claude eli5 turn has closed. */
it.skipIf(!root || !contextEventId)(
  "axli records exactly one repository eli5 invocation from a native Claude turn",
  async () => {
    const storage = await openProjectStorage(root!);
    try {
      const context = storage.events.get(contextEventId!);
      expect(context).toMatchObject({
        type: "terminal.context.prepared",
        actor: { provider: "claude" },
      });
      const id = (suffix: string) => `evt_${sha256(`${contextEventId}\0${suffix}`).slice(7, 39)}`;
      const observed = storage.events.get(id("invocation:0"));
      const assessed = storage.events.get(id("assessed"));
      expect(observed).toMatchObject({
        type: "terminal.skill.observed",
        payload: {
          skillId: "eli5",
          path: ".agents/skills/eli5/SKILL.md",
          provider: "claude",
          source: "provider_transcript",
          contentHash: sha256(await readFile(resolve(root!, ".agents/skills/eli5/SKILL.md"))),
          providerSessionDigest: context!.payload.providerSessionDigest,
          providerTurnDigest: context!.payload.providerTurnDigest,
        },
      });
      expect(storage.events.get(id("invocation:1"))?.payload.source).not.toBe(
        "provider_transcript",
      );
      expect(assessed).toMatchObject({
        type: "terminal.skill.turn_assessed",
        payload: { skillTelemetry: "observed" },
      });
      let afterSeq = context!.seq;
      const closing = [];
      while (true) {
        const batch = storage.events.list({ afterSeq, limit: 1000 });
        if (batch.length === 0) break;
        closing.push(
          ...batch.filter(
            (event) =>
              event.type === "terminal.turn.observed" &&
              event.payload.contextEventId === contextEventId,
          ),
        );
        afterSeq = batch.at(-1)!.seq;
      }
      expect(closing).toHaveLength(1);
      expect(assessed!.seq).toBeGreaterThan(closing[0]!.seq);
    } finally {
      await storage.close();
    }
  },
);
