import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { FileSystemCas } from "@lervo/cas";
import { registerAgent } from "@lervo/agent-workforce";
import {
  applyInitPlan,
  createInitPlan,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { defaultRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { verificationSuiteHash } from "@lervo/verification";
import type { ProjectStorage } from "@lervo/project-storage";
import { convergenceDelegationPlanHash, type ConvergenceDelegation } from "../src/delegation.js";

const execute = promisify(execFile);
export async function fixture(
  authorized = false,
  canonical = false,
  multipleSuites = false,
  invalidAssessmentCalls = 0,
  writableEventSchemaVersion: 4 | 5 = 4,
) {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-autonomous-knowledge-"));
  const root = resolve(directory, "repository");
  await mkdir(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_convergence_runtime" }));
  await mkdir(resolve(root, "docs/specs"), { recursive: true });
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Repository instructions\n\nKeep runtime requirements and user-owned content unchanged.\n",
  );
  await writeFile(
    resolve(root, "README.md"),
    "# Repository\n\nSee [runtime](docs/specs/runtime.md).\n",
  );
  await writeFile(
    resolve(root, "docs/specs/runtime.md"),
    "# Runtime\n\nThe runtime works locally without a Hub.\n",
  );
  await writeFile(
    resolve(root, ".lervo/knowledge/policy.yaml"),
    JSON.stringify({
      ...defaultRepositoryKnowledgePolicy,
      normalization: { exclude: ["AGENTS.md", "CLAUDE.md", "README.md"] },
      exclude: [...defaultRepositoryKnowledgePolicy.exclude, ".lervo/verifications/**"],
    }),
  );
  if (canonical) {
    await mkdir(resolve(root, "src"));
    await writeFile(resolve(root, "src/runtime.ts"), "export const maximumBackgroundCalls = 2;\n");
  }
  await execute("git", ["-C", root, "init", "-b", "main"]);
  // A detached automatic gc would repack and prune loose objects while a test copies or reads
  // the repository; git estimates the loose count from one object directory, so it can trigger
  // on a small fixture.
  await execute("git", ["-C", root, "config", "gc.auto", "0"]);
  await execute("git", ["-C", root, "config", "maintenance.auto", "false"]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@lervo.invalid",
    "add",
    ".",
  ]);
  await execute("git", [
    "-C",
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@lervo.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  await execute("git", ["-C", root, "branch", "knowledge-integration"]);
  const paths = resolveProjectPaths(root);
  const manifest = await loadProjectManifest(root);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
    writableEventSchemaVersion,
  });
  const artifacts = await FileSystemCas.open(paths.cas);
  const storage: ProjectStorage = {
    manifest,
    paths,
    events,
    artifacts,
    writableEventSchemaVersion,
    close: async () => events.close(),
  };
  let delegation: ConvergenceDelegation | null = null;
  if (authorized) {
    const parent = await registerAgent({
      repositoryRoot: root,
      roleId: "developer",
      provider: "claude",
      responsibilityPaths: ["*"],
    });
    const role = await resolveRoleContract(root, "developer");
    const binding = {
      roleId: "developer",
      version: role.version,
      contractHash: role.contractHash,
      profileHash: roleProfileHash(role.definition.profile),
      capabilityHash: parent.capabilityHash,
    };
    const suite = {
      schemaVersion: 1 as const,
      suiteId: "knowledge.fixture",
      stopOnFailure: true as const,
      commands: [
        {
          commandId: "check",
          executable: "node",
          arguments: [
            "-e",
            "if(!require('node:fs').readFileSync('docs/specs/runtime.md','utf8').includes('locally without a Hub'))throw new Error('Missing local runtime contract');",
          ],
          cwd: ".",
          timeoutMs: 10000,
          maxOutputBytes: 16384,
          environmentVariableNames: [],
        },
      ],
    };
    await mkdir(resolve(root, ".lervo/verifications"), { recursive: true });
    await writeFile(
      resolve(root, ".lervo/verifications/knowledge.fixture.yaml"),
      JSON.stringify(suite),
    );
    const additionalSuite = { ...suite, suiteId: "knowledge.alpha" };
    if (multipleSuites)
      await writeFile(
        resolve(root, ".lervo/verifications/knowledge.alpha.yaml"),
        JSON.stringify(additionalSuite),
      );
    const plan: Omit<ConvergenceDelegation, "review"> = {
      schemaVersion: 1,
      projectId: manifest.projectId,
      state: "active",
      parentAgentId: parent.agentId,
      parentRoleHash: role.contractHash,
      roles: { generator: binding, reviewer: binding, writer: binding, integrator: binding },
      canonicalRoots: ["docs/specs", "AGENTS.md", "CLAUDE.md"],
      normalizationRoots: ["docs/specs", "AGENTS.md", "CLAUDE.md"],
      providers: ["claude"],
      verification: [
        { suiteId: suite.suiteId, suiteHash: verificationSuiteHash(suite) },
        ...(multipleSuites
          ? [
              {
                suiteId: additionalSuite.suiteId,
                suiteHash: verificationSuiteHash(additionalSuite),
              },
            ]
          : []),
      ],
      integrationTarget: {
        ref: "refs/heads/knowledge-integration",
        repositoryIdentityHash: calculateProjectIdentityHash(manifest),
      },
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      resourceCeilings: {
        maximumStages: 8,
        maximumDocuments: 8,
        maximumSourceBytes: 1048576,
        maximumProviderCalls: 8,
      },
    };
    delegation = {
      ...plan,
      review: {
        reviewerAgentId: parent.agentId,
        reviewedAt: new Date().toISOString(),
        planHash: convergenceDelegationPlanHash(plan),
      },
    };
    await writeFile(
      resolve(root, ".lervo/knowledge/convergence-delegation.json"),
      JSON.stringify(delegation),
    );
  }
  const log = resolve(directory, "provider-calls.jsonl");
  const executable = resolve(directory, "claude-fixture.mjs");
  await writeFile(
    executable,
    `#!/usr/bin/env node
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=value=>'sha256:'+createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
if(process.argv.includes('--version')){console.log('claude-fixture 1.0.0');process.exit(0);}
let text='';for await(const chunk of process.stdin)text+=chunk;
const request=JSON.parse(text);const data=request.untrustedSourceData;let response;
const prior=existsSync(${JSON.stringify(log)})?readFileSync(${JSON.stringify(log)},'utf8').trim().split('\\n').filter(Boolean).map(line=>JSON.parse(line)).filter(call=>call.request.task==='canonical_baseline_assessment').length:0;
appendFileSync(${JSON.stringify(log)},JSON.stringify({cwd:process.cwd(),request})+'\\n');
if(request.envelope){response={schemaVersion:1,documents:request.envelope.documents.map(document=>({sourcePath:document.path,outputs:[{path:document.path,content:document.untrustedSourceData,coveredUnitIndexes:document.sourceUnits.map(unit=>unit.index)}]})),telemetry:{filesystemReads:0,filesystemWrites:0,shellProcesses:0,networkRequests:0,externalActions:0,toolCalls:0,complete:true}};}
else if(request.task==='canonical_baseline_assessment')response={decisions:data.sources.map(source=>({path:source.path,contentHash:source.contentHash,disposition:'no_change',rationale:'This exact source preserves the existing local runtime contract. No new durable fact or behavioral obligation requires a canonical change.',canonicalReferences:[]})),drafts:[]};
if(request.task==='canonical_baseline_assessment' && prior<${JSON.stringify(invalidAssessmentCalls)})response.decisions[0].contentHash=hash('wrong source bytes');
if(request.task==='canonical_baseline_assessment' && ${JSON.stringify(canonical)}) { const source=data.sources.find(source=>source.path==='src/runtime.ts'); const target=data.sources.find(source=>source.path==='docs/specs/runtime.md')??data.context.find(document=>document.path==='docs/specs/runtime.md'); if(source && target) { const limit=source.content?.includes('= 3')?'three':'two'; response.decisions.find(item=>item.path===source.path).disposition='candidate'; response.drafts=[{path:target.path,beforeHash:target.contentHash,content:target.content+'\\nBackground model calls are limited to '+limit+' per host.\\n'}];} }
if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve',rationale:'Each supplied source has been independently compared with the exact current instructions and documentation. The current durable runtime requirement remains fully preserved.',sourceHashes:data.sourceHashes,draftHashes:data.draftHashes};
else if(request.task==='independent_normalization_review')response={candidateId:data.candidate.candidateId,decisions:data.candidate.items.map(item=>({operationId:item.operationId,sourceContentHash:item.sourceContentHash,decision:'approve',rationale:'The exact source and all output bytes preserve the runtime requirement, examples, links, lifecycle metadata, protected regions and resource identities.',checks:Object.fromEntries(['meaning','requirements','examples','links','lifecycle','protectedRegions','skillIdentity','resources'].map(check=>[check,true])),unitReviews:item.sourceUnitVersionIds.map(id=>({unitVersionId:id,outputHashes:item.outputs.filter(output=>output.coveredUnitVersionIds.includes(id)).map(output=>output.contentHash),rationale:'This exact source unit is preserved in the specified output bytes.'}))}))};
else if(request.task==='knowledge_provider_availability_probe')response={nonce:data.nonce};
else if(request.task==='repository_change_knowledge_review')response={classification:'implementation_only'};
else if(request.task==='canonical_candidate_resolution')response={decisions:data.candidates.map(candidate=>({candidateId:candidate.candidateId,contentHash:candidate.contentHash,decision:'reject',rationale:'The independently reviewed current source facts preserve the existing durable runtime contract. This historical candidate is obsolete under the exact source-bound baseline coverage.',targetPath:null,targetContentHash:null,targetQuote:null}))};
else if(request.task==='document_route_classification')response={classifications:data.documents.map(document=>({path:document.path,contentHash:document.contentHash,outcome:'uncertain',routeId:null,roleId:null,rationale:'The fixture classifier never places a document without an explicit route.'}))};
else if(request.task==='lifecycle_exact_plan_review')response={planHash:data.planHash,decision:'approve',rationale:'The exact deterministic lifecycle plan preserves all original instruction bytes, meaning, links and user-owned content within the supplied permitted path scope.'};
else if(!response) throw new Error('Unexpected fixture task '+request.task);
console.log(JSON.stringify({is_error:false,result:JSON.stringify(response),structured_output:response,permission_denials:[],stop_reason:'tool_use',num_turns:3,usage:{server_tool_use:{web_search_requests:0,web_fetch_requests:0}},modelUsage:{fixture:{inputTokens:10,cacheReadInputTokens:0,cacheCreationInputTokens:0,outputTokens:5,contextWindow:200000}}}));
`,
    { mode: 0o700 },
  );
  return {
    directory,
    root,
    storage,
    events,
    artifacts,
    delegation,
    executable,
    log,
    admissionDirectory: resolve(directory, "admission"),
  };
}
