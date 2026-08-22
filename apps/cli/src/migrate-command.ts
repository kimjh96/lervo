import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyIdentityMigration,
  createIdentityMigrationPlan,
  type IdentityMigrationPlan,
} from "@lervo/identity-migration";

import type { CliIo } from "./types.js";

export const migrateUsage =
  "  lervo migrate identity [--root <path>] [--apply <plan-id>] [--json]";

export function formatIdentityMigrationPlan(plan: IdentityMigrationPlan): string {
  const lines = [
    `명칭 migration 대상: ${plan.repositoryRoot}`,
    `계획 ID: ${plan.planId}`,
    `계획 상태: ${plan.status === "ready" ? "적용 가능" : "적용 불가"}`,
  ];
  if (plan.status === "ready") {
    lines.push(
      `보존할 event: ${plan.preservedEventCount}개`,
      `확인한 CAS object: ${plan.verifiedCasObjectCount}개`,
      ...(plan.documentDisposition === "archive_previous_metadata"
        ? ["이전 marker를 쓰는 문서 metadata는 원본 그대로 archive하고 활성 registry는 비워 둡니다."]
        : []),
      "아직 파일을 변경하지 않았습니다.",
      `적용하려면 --apply ${plan.planId}를 붙여 다시 실행하세요.`,
    );
  } else {
    for (const item of plan.blockers) lines.push(`  확인 필요 [${item.code}] ${item.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runMigrateCommand(args: string[], io: CliIo): Promise<number> {
  if (args[0] !== "identity") {
    io.stderr(`지원하는 migration 종류를 지정하세요.\n${migrateUsage}\n`);
    return 1;
  }
  let values: { root?: string; apply?: string; json?: boolean; help?: boolean };
  try {
    const parsed = parseArgs({
      args: args.slice(1),
      strict: true,
      allowPositionals: false,
      options: {
        root: { type: "string" },
        apply: { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
    values = parsed.values;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${migrateUsage}\n`);
    return 1;
  }
  if (values.help) {
    io.stdout(`${migrateUsage}\n`);
    return 0;
  }

  try {
    const plan = await createIdentityMigrationPlan(resolve(io.cwd, values.root ?? "."));
    if (values.apply === undefined) {
      io.stdout(values.json ? `${JSON.stringify(plan, null, 2)}\n` : formatIdentityMigrationPlan(plan));
      return plan.status === "ready" ? 0 : 1;
    }
    if (values.apply !== plan.planId) {
      io.stderr("적용 요청의 plan ID가 현재 읽기 전용 계획과 다릅니다. 계획을 다시 확인하세요.\n");
      return 1;
    }
    const receipt = await applyIdentityMigration(plan);
    io.stdout(
      values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `명칭 migration을 완료했습니다. projectId: ${receipt.projectId}\n보존한 event: ${receipt.preservedEventCount}개\n확인한 CAS object: ${receipt.verifiedCasObjectCount}개\n${receipt.documentArchivePath === null ? "" : `이전 문서 metadata archive: ${receipt.documentArchivePath}\n`}`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}
