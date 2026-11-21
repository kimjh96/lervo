import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { dispatchFixture } from "./supervision-dispatch.fixture.js";

/** Which attempts the fake native owner rejects, counted from the first attempt. */
export interface NativeCompletionProviderVerdicts {
  /** Leading attempts whose independent writing judgement fails before any completion. */
  writingRejections: number;
  /** Following attempts whose owner review requests rework after a completed result. */
  reviewRejections: number;
}

export async function configureNativeCompletionProvider(
  f: Awaited<ReturnType<typeof dispatchFixture>>,
  verdicts: NativeCompletionProviderVerdicts,
  log: string,
  promptLog: string,
) {
  const attempt = "(context.facts.assignments[0].recovery?.attemptNumber ?? 1)";
  const writingFailed = `${attempt} <= ${verdicts.writingRejections}`;
  const reviewRejected = `${attempt} <= ${verdicts.writingRejections + verdicts.reviewRejections}`;
  const login = (await readFile(f.login.executable, "utf8")).replace(
    "const args=",
    "function inspectLogin(){\nconst args=",
  );
  let provider = (
    await readFile(resolve("scripts/distribution/fixtures/installed-capability-codex.mjs"), "utf8")
  )
    .replace(/^#![^\n]*\n/u, "")
    .replaceAll("src/result.ts", "src/save.ts");
  provider = provider.replace(
    "function completeTurn(content) {",
    `function completeTurn(content) {
    send({method:"thread/tokenUsage/updated",params:{threadId,turnId,tokenUsage:{total:{inputTokens:40,cachedInputTokens:0,outputTokens:10,reasoningOutputTokens:0,totalTokens:50},modelContextWindow:100000}}});`,
  );
  provider = provider.replace(
    "    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;",
    `
    if (instructions.includes("Act as the registered product owner.")) {
      const context = JSON.parse(instructions.slice(instructions.lastIndexOf("\\n\\n") + 2));
      const task = context.facts.tasks.assignments[0];
      let operation, details;
      if (context.trigger.nextAction === "publish_result") {
        operation = "prepare_publication";
        details = {writingPolicyId:context.facts.resultWritingContract.writingPolicyId,checks:context.facts.resultWritingContract.verification.semanticChecks.filter(check=>check.required).map(check=>({checkId:check.checkId,status:"passed",violationCount:0}))};
      } else if (task.review?.verdict === "rework") {
        operation="request_rework";
        const before = context.facts.responsibilities[0].binding.responsibility;
        details={assignmentId:task.assignmentId,task:{roleId:before.roleId,taskPurpose:"Recheck and correct the rejected result while preserving the saved value.",deliverables:before.deliverables,acceptanceCriteria:before.acceptanceCriteria,decisionLatitude:before.decisionLatitude,expectedPaths:before.expectedPaths,requiredCapabilities:before.requiredCapabilities,verificationSuiteIds:before.verificationSuiteIds,completionSeconds:600}};
      } else if (task.status === "leased") {
        operation = "prepare_completion";
        details = {assignmentId:task.assignmentId,writingPolicyId:context.facts.writingContract.writingPolicyId,checks:context.facts.writingContract.verification.semanticChecks.filter(check=>check.required).map(check=>({checkId:check.checkId,status:${writingFailed} ? "failed" : "passed",violationCount:${writingFailed} ? 1 : 0}))};
      } else if (task.review === null) {operation="review_artifacts";details={assignmentId:task.assignmentId,verdict:${reviewRejected} ? "rework" : "accepted"};}

      else {operation="complete_workstream";details={result:"The saved value was updated and verified in the assigned workspace. The original repository remains available for integration."};}
      await appendFile(${JSON.stringify(log)}, operation+"\\n");
      completeTurn(JSON.stringify({schemaVersion:1,operation,rationale:"The fixture independently evaluated the exact returned evidence.",details:JSON.stringify(details)})); return;
    }
    const targetPath = process.env.LERVO_INSTALLED_CAPABILITY_TARGET;`,
  );
  await writeFile(
    f.login.executable,
    `${login}\n}\nif(process.argv[2]!=="app-server")inspectLogin();\nprocess.env.LERVO_INSTALLED_CAPABILITY_TARGET=process.cwd()+"/src/save.ts";\nprocess.env.LERVO_INSTALLED_CAPABILITY_PROMPT_LOG=${JSON.stringify(promptLog)};\nprocess.env.LERVO_INSTALLED_CAPABILITY_CHANGE_KIND="update";\nprocess.env.LERVO_INSTALLED_CAPABILITY_CONTENT="export const saved = 'verified';\\n";\nprocess.env.LERVO_INSTALLED_CAPABILITY_RESULT="The saved value was updated and verification passed.";\n${provider}`,
  );
}
