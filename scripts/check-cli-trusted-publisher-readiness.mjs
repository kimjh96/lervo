import {
  checkCliTrustedPublisherReadiness,
  formatTrustedPublisherReadiness,
} from "./lib/cli-trusted-publisher-readiness.mjs";
import { TrustedPublisherReadinessError } from "./lib/trusted-publisher-readiness.mjs";

function failArguments() {
  throw new TrustedPublisherReadinessError(
    "trusted_publisher_readiness_arguments_invalid",
    "Trusted Publisher 준비 상태 명령 인자가 올바르지 않습니다.",
  );
}

function parseArguments(args) {
  let repository;
  let online = false;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === "--online") {
      if (online) failArguments();
      online = true;
      continue;
    }
    if (name === "--json") {
      if (json) failArguments();
      json = true;
      continue;
    }
    if (name !== "--repository" || repository !== undefined || index + 1 >= args.length) {
      failArguments();
    }
    repository = args[index + 1];
    index += 1;
  }
  if (repository === undefined) failArguments();
  return { repository, online, json };
}

try {
  const { json, ...options } = parseArguments(process.argv.slice(2));
  const report = await checkCliTrustedPublisherReadiness(options);
  process.stdout.write(json
    ? `${JSON.stringify(report, null, 2)}\n`
    : formatTrustedPublisherReadiness(report));
  if (report.status !== "ready") process.exitCode = 1;
} catch (error) {
  if (error instanceof TrustedPublisherReadinessError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(
      "trusted_publisher_readiness_failed: Trusted Publisher 준비 상태를 확인하지 못했습니다.",
    );
  }
  process.exitCode = 1;
}
