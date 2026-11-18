import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyDurableKnowledgeOperations,
  authorizeCurrentRepositoryDocumentLayout,
  GENERATED_DURABLE_INSTRUCTION_DIRECTORY,
  sha256,
  stableId,
  type KnowledgeFileOperation,
} from "@lervo/repository-knowledge";
import {
  commitRetiredInstruction,
  instructionCandidateApplyAuthority,
} from "@lervo/repository-knowledge-runtime";

const RULE_ID = /^rule_[a-f0-9]{24}$/u;

export interface RetiredDurableInstruction {
  schemaVersion: 1;
  status: "retired";
  ruleId: string;
  path: string;
  commitHash: string | null;
}

/**
 * ADR-0561 undo of an applied owner rule: deletes its Lervo-generated file. On a Hub convergence
 * owner the deletion is committed as `Lervo Knowledge`; elsewhere the deletion stays in the working
 * tree for the ordinary commit. Git history keeps the rule, so stating it again restores it.
 */
export async function retireDurableInstruction(input: {
  repositoryRoot: string;
  ruleId: string;
}): Promise<RetiredDurableInstruction> {
  if (!RULE_ID.test(input.ruleId)) throw new Error("The rule ID is invalid.");
  const path = `${GENERATED_DURABLE_INSTRUCTION_DIRECTORY}/${input.ruleId}.md`;
  let content: string;
  try {
    content = await readFile(resolve(input.repositoryRoot, path), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Error(`No applied owner rule ${input.ruleId} exists.`, { cause: error });
    throw error;
  }
  const operations: KnowledgeFileOperation[] = [
    {
      path,
      action: "delete",
      ownership: "lervo_generated",
      mediaType: "text/markdown",
      expectedCurrentHash: sha256(content),
      desiredHash: sha256("lervo:absent\n"),
      reason: "owner_rule_retired",
    },
  ];
  const storage = await openProjectStorage(input.repositoryRoot);
  const projectId = storage.manifest.projectId;
  await storage.close();
  await applyDurableKnowledgeOperations({
    repositoryRoot: input.repositoryRoot,
    projectId,
    planId: stableId("kinstructionretire", { ruleId: input.ruleId, hash: sha256(content) }),
    operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: input.repositoryRoot,
      operations,
    }),
    receipt: null,
    recordApplied: () => undefined,
  });
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  const commitHash =
    authority.status === "owner"
      ? await commitRetiredInstruction({
          repositoryRoot: input.repositoryRoot,
          path,
          ruleId: input.ruleId,
        })
      : null;
  return { schemaVersion: 1, status: "retired", ruleId: input.ruleId, path, commitHash };
}
